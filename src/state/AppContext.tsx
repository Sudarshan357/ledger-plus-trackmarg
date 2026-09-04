import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  api,
  ApiError,
  CLIENT_ID,
  eventsUrl,
  getToken,
  setToken,
  takeUnlockGrant,
} from '../api/client';
import {
  clearOfflineData,
  loadSnapshot,
  onConnectivityChange,
  savePinVerifier,
  saveSnapshot,
  tryOfflineUnlock,
} from '../lib/offline';
import type { Me, Overview, PendingApproval, Transaction, TxnType } from '../lib/types';

/// What GET /bootstrap returns: everything the app renders, in one request.
interface Bootstrap extends Me {
  overview: Overview;
  transactions: Transaction[];
  pendingApproval: PendingApproval | null;
}

interface RegisterInput {
  mode: 'create' | 'join';
  name: string;
  phone: string;
  pin: string;
  confirmPin: string;
  groupCode?: string;
  businessName?: string;
}

interface NewTransaction {
  type: TxnType;
  category: string;
  amount: number;
  date: string;
  notes: string;
  /// Whose entry it is. The server validates this is a partner in the group; who actually
  /// recorded it always comes from the session, never from here.
  ownerId: string;
}

interface TransactionEdit {
  type: TxnType;
  category: string;
  amount: number;
  date: string;
  notes: string;
}

interface AppState {
  /// 'booting' until we know whether there is a usable session.
  status: 'booting' | 'signed-out' | 'locked' | 'ready' | 'frozen';
  me: Me | null;
  overview: Overview | null;
  transactions: Transaction[];
  /// A change one partner has asked the other to agree to, if any.
  pendingApproval: PendingApproval | null;
  loading: boolean;
  error: string | null;
  /// Showing cached figures because the server could not be reached. Read-only: saving is
  /// refused while this is true, because the ledger has two authors and a queued write would
  /// be replayed against a state that had moved on.
  offline: boolean;
  /// When the cached figures were last read from the server. Null when they are live.
  lastSyncedAt: number | null;

  register: (input: RegisterInput) => Promise<void>;
  login: (input: { groupCode: string; phone: string; pin: string }) => Promise<void>;
  unlock: (pin: string) => Promise<void>;
  lock: () => void;
  logout: () => Promise<void>;

  refresh: () => Promise<void>;
  /// Re-checks whether support has lifted a freeze. Safe to call repeatedly.
  retryFrozen: () => Promise<void>;
  addTransaction: (input: NewTransaction) => Promise<void>;
  /// Resolves to `applied: false` when the entry is more than 10 minutes old and there is a
  /// partner to ask - the change is then a pending approval, not yet written to the entry.
  updateTransaction: (id: string, input: TransactionEdit) => Promise<{ applied: boolean }>;
  deleteTransaction: (id: string) => Promise<void>;
}

/// How long to wait for the SSE `connected` handshake before deciding the stream is being
/// buffered by something in between. Generous enough for a slow mobile handshake, short
/// enough that a partner is not staring at stale figures.
const SSE_HANDSHAKE_TIMEOUT_MS = 6000;

/// Poll cadence once SSE has been ruled out. A refresh is one request of roughly a second,
/// so this is cheap while still feeling live for two people sharing a ledger.
const POLL_INTERVAL_MS = 10000;

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AppState['status']>('booting');
  const [me, setMe] = useState<Me | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  // Guards against a slow response from a previous session landing after a newer one and
  // repainting the screen with stale figures.
  const requestSeq = useRef(0);

  // `silent` skips the loading flag: used for the reconcile after a save, which happens
  // behind a screen the user is already looking at and should not flicker.
  const loadAll = useCallback(async (silent = false): Promise<boolean> => {
    const seq = ++requestSeq.current;
    if (!silent) setLoading(true);
    try {
      // One request. This used to be three (/account/me + /transactions/overview +
      // /transactions), which each re-authenticated and re-read the same partners and session
      // against a database in another region - about two seconds of latency to answer one
      // question. See backend/src/routes/bootstrap.routes.ts.
      const data = await api<Bootstrap>('/bootstrap');
      if (seq !== requestSeq.current) return false;
      setMe({
        user: data.user,
        group: data.group,
        role: data.role,
        partners: data.partners,
        session: data.session,
      });
      setOverview(data.overview);
      setTransactions(data.transactions);
      setPendingApproval(data.pendingApproval);
      setError(null);
      // Back on live data, whatever we were showing before.
      setOffline(false);
      setLastSyncedAt(null);
      // Kept for the next launch without a network. Written here rather than at any single
      // call site so it covers every path that refreshes - unlock, resume, SSE, polling.
      saveSnapshot(data.user.id, data);
      return true;
    } catch (err) {
      if (seq !== requestSeq.current) return false;
      if (err instanceof ApiError && err.status === 401) {
        setToken(null);
        // The session is gone, so the cache behind it must go too: it belongs to a partner
        // who is no longer signed in on this device.
        clearOfflineData();
        setStatus('signed-out');
        return false;
      }
      // status 0 is a network-level failure, not a server that said no. If there are cached
      // figures, showing them beats showing nothing - as long as it is labelled.
      if (err instanceof ApiError && err.status === 0) {
        const snap = loadSnapshot<Bootstrap>();
        if (snap) {
          const data = snap.data;
          setMe({
            user: data.user,
            group: data.group,
            role: data.role,
            partners: data.partners,
            session: data.session,
          });
          setOverview(data.overview);
          setTransactions(data.transactions);
          setPendingApproval(data.pendingApproval);
          setOffline(true);
          setLastSyncedAt(snap.at);
          setError(null);
          return true;
        }
      }
      // Frozen is a state the app sits in, not a message to show over a half-loaded screen.
      // Everything already loaded is dropped, the same as locking.
      if (err instanceof ApiError && err.code === 'ACCOUNT_FROZEN') {
        setMe(null);
        setOverview(null);
        setTransactions([]);
        setPendingApproval(null);
        setStatus('frozen');
        return false;
      }
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      return false;
    } finally {
      if (seq === requestSeq.current && !silent) setLoading(false);
    }
  }, []);

  // On every launch a stored token means "locked", never "straight in". Section 2 of the
  // brief is explicit about it, and it is the right default for an app holding two people's
  // money: the token proves the device was enrolled, the PIN proves who is holding it now.
  //
  // The single exception is the support console handing over an impersonation token: support
  // does not know the client's PIN, so it leaves a one-shot grant that skips the lock exactly
  // once. Consuming it here means the very next reload locks again like any other launch.
  useEffect(() => {
    if (!getToken()) {
      setStatus('signed-out');
      return;
    }
    if (takeUnlockGrant()) {
      // If the token turns out to be dead, loadAll clears it and flips to signed-out - so
      // only claim 'ready' if it survived.
      void loadAll().then((ok) => {
        if (ok) setStatus('ready');
      });
      return;
    }
    setStatus('locked');
  }, [loadAll]);

  // Live sync, with a fallback.
  //
  // The happy path is server-sent events: the other partner saves something and this device
  // is pushed the change immediately. But an SSE stream only works if every hop between here
  // and the server forwards bytes as they are written, and plenty do not - Cloudflare quick
  // tunnels accept the connection and then buffer the body indefinitely (measured: nothing at
  // all after 8s, versus first byte at 0ms direct). A naive client cannot tell that apart from
  // "nothing has happened yet", so it would show stale figures forever and look like the app
  // simply stopped syncing.
  //
  // So the stream has to prove itself: if the `connected` handshake does not arrive promptly,
  // the stream is being buffered somewhere and we drop to polling instead. Slower, but it
  // always works, and the user never sees a ledger that quietly stopped updating.
  useEffect(() => {
    if (status !== 'ready') return;
    const url = eventsUrl();
    if (!url) return;

    const source = new EventSource(url);
    let pollTimer: ReturnType<typeof setInterval> | undefined;

    // Every mutation broadcasts to the whole group, including back to the tab that caused it.
    // That tab has already applied the change, so reacting to its own echo just means doing
    // the same full reload twice.
    const onChange = (event: MessageEvent) => {
      try {
        if ((JSON.parse(event.data) as { actor?: string }).actor === CLIENT_ID) return;
      } catch {
        /* malformed payload - fall through and refresh anyway */
      }
      void loadAll(true);
    };

    const fallBackToPolling = () => {
      if (pollTimer) return;
      source.close();
      pollTimer = setInterval(() => {
        // Only while the user is looking at it. A backgrounded tab polling every few seconds
        // is just battery and mobile data; the visibilitychange handler below re-syncs the
        // moment they come back anyway.
        if (document.visibilityState === 'visible') void loadAll(true);
      }, POLL_INTERVAL_MS);
    };

    const handshake = setTimeout(fallBackToPolling, SSE_HANDSHAKE_TIMEOUT_MS);
    const onConnected = () => clearTimeout(handshake);

    const onFrozen = () => setStatus('frozen');
    const onUnfrozen = () => void loadAll(true);

    source.addEventListener('connected', onConnected);
    source.addEventListener('account-frozen', onFrozen);
    source.addEventListener('account-unfrozen', onUnfrozen);
    source.addEventListener('ledger-changed', onChange);
    source.addEventListener('session-changed', onChange);
    source.addEventListener('partner-joined', onChange);

    return () => {
      clearTimeout(handshake);
      if (pollTimer) clearInterval(pollTimer);
      source.removeEventListener('connected', onConnected);
      source.removeEventListener('account-frozen', onFrozen);
      source.removeEventListener('account-unfrozen', onUnfrozen);
      source.removeEventListener('ledger-changed', onChange);
      source.removeEventListener('session-changed', onChange);
      source.removeEventListener('partner-joined', onChange);
      source.close();
    };
  }, [status, loadAll]);

  // A phone that was backgrounded for an hour may have missed events entirely - the socket
  // dies quietly when the OS suspends the tab. Re-syncing on resume is what keeps the two
  // partners' screens honest after a commute.
  useEffect(() => {
    if (status !== 'ready') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadAll(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [status, loadAll]);

  // Offline is a state to leave as soon as possible, not one to sit in until the next poll.
  // navigator.onLine firing is only a hint that something changed - loadAll is what actually
  // decides, by trying, and it falls straight back to the snapshot if the network lied.
  useEffect(() => {
    if (!offline || status !== 'ready') return;
    return onConnectivityChange(() => void loadAll(true));
  }, [offline, status, loadAll]);

  const register = useCallback(
    async (input: RegisterInput) => {
      const res = await api<{ token: string }>('/auth/register', { method: 'POST', body: input });
      setToken(res.token);
      // A fresh device: whatever was cached belonged to whoever used it last.
      clearOfflineData();
      void savePinVerifier(input.pin);
      if (await loadAll()) setStatus('ready');
    },
    [loadAll],
  );

  const login = useCallback(
    async (input: { groupCode: string; phone: string; pin: string }) => {
      const res = await api<{ token: string }>('/auth/login', { method: 'POST', body: input });
      setToken(res.token);
      clearOfflineData();
      void savePinVerifier(input.pin);
      if (await loadAll()) setStatus('ready');
    },
    [loadAll],
  );

  const unlock = useCallback(
    async (pin: string) => {
      try {
        // The server is the authority whenever it can be reached: it holds the real PIN hash
        // and it rate-limits. An unlock the client decided on its own would not be a lock.
        await api('/account/unlock', { method: 'POST', body: { pin } });
      } catch (err) {
        // Only a network failure falls back. A 401 from the server is a wrong PIN and must
        // stay wrong - checking again locally could only ever overrule a correct rejection.
        if (!(err instanceof ApiError && err.status === 0)) throw err;

        const snap = loadSnapshot<Bootstrap>();
        if (!snap) throw err;

        const result = await tryOfflineUnlock(pin);
        if (result === 'locked-out') {
          throw new ApiError(0, 'Too many attempts. Try again in a few minutes, or reconnect.');
        }
        if (result === 'unavailable') {
          throw new ApiError(0, 'Cannot reach the server, and this device has nothing saved to unlock with.');
        }
        if (result === 'wrong-pin') throw new ApiError(0, 'Incorrect PIN.');

        // loadAll will fail the same way this did and fall through to the snapshot, which
        // keeps the offline entry path identical to the offline refresh path.
        if (await loadAll()) setStatus('ready');
        return;
      }

      // Recorded only after the server agreed, so it can never disagree with the real PIN.
      void savePinVerifier(pin);
      if (await loadAll()) setStatus('ready');
    },
    [loadAll],
  );

  const lock = useCallback(() => {
    // Every figure is dropped from memory, not just hidden behind a route.
    setMe(null);
    setOverview(null);
    setTransactions([]);
    setPendingApproval(null);
    setStatus('locked');
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/account/logout', { method: 'POST' });
    } catch {
      // A revoke that fails (offline, expired) must still clear this device.
    }
    setToken(null);
    // The figures and the PIN verifier are this partner's; the next person to sign in on this
    // phone must not be able to unlock into them.
    clearOfflineData();
    setMe(null);
    setOverview(null);
    setTransactions([]);
    setPendingApproval(null);
    setOffline(false);
    setLastSyncedAt(null);
    setStatus('signed-out');
  }, []);

  // Both of these return as soon as the WRITE is durable, not once every figure on every
  // screen has been re-fetched. The row is applied locally straight away so the ledger is
  // correct the instant the screen appears, and the authoritative totals land a moment later
  // from the background reconcile. Waiting for that round trip before letting go of the form
  // was most of the delay after tapping Save.
  /// Asks the server whether the freeze has been lifted. loadAll already routes a 423 back to
  /// the frozen state and a success into a normal load, so this is just "try again".
  const retryFrozen = useCallback(async () => {
    if (!getToken()) {
      setStatus('signed-out');
      return;
    }
    // loadAll routes a 423 straight back to 'frozen', so only a genuine success lifts it.
    if (await loadAll(true)) setStatus('ready');
  }, [loadAll]);

  /// Why writes are refused rather than queued.
  ///
  /// This ledger has two authors. A queued entry would be replayed later against a state that
  /// had moved on - the other partner may have settled the session, started a fresh one, or
  /// entered the same expense from their own phone. Replaying blindly invents figures neither
  /// of them entered, and in an app whose whole purpose is agreeing on money, quietly wrong
  /// is far worse than plainly unavailable. Offline is read-only, and says so.
  const refuseOffline = useCallback(() => {
    if (offline) {
      throw new ApiError(0, 'You are offline. Reconnect to save - your ledger is shown as of the last sync.');
    }
  }, [offline]);

  const addTransaction = useCallback(
    async (input: NewTransaction) => {
      refuseOffline();
      const { transaction } = await api<{ transaction: Transaction }>('/transactions', {
        method: 'POST',
        body: input,
      });
      setTransactions((prev) => [transaction, ...prev]);
      void loadAll(true);
    },
    [loadAll, refuseOffline],
  );

  const updateTransaction = useCallback(
    async (id: string, input: TransactionEdit) => {
      refuseOffline();
      const res = await api<{ applied: boolean; transaction?: Transaction; approvalId?: string }>(
        `/transactions/${id}`,
        { method: 'PATCH', body: input },
      );
      if (res.applied && res.transaction) {
        const saved = res.transaction;
        setTransactions((prev) => prev.map((txn) => (txn.id === id ? saved : txn)));
      }
      // Whether applied directly or turned into a pending approval, the figures (or the
      // approval banner) need to reflect it right away.
      void loadAll(true);
      return { applied: res.applied };
    },
    [loadAll, refuseOffline],
  );

  const deleteTransaction = useCallback(
    async (id: string) => {
      refuseOffline();
      await api(`/transactions/${id}`, { method: 'DELETE' });
      setTransactions((prev) => prev.filter((txn) => txn.id !== id));
      void loadAll(true);
    },
    [loadAll, refuseOffline],
  );

  const value = useMemo<AppState>(
    () => ({
      status,
      me,
      overview,
      transactions,
      pendingApproval,
      loading,
      error,
      offline,
      lastSyncedAt,
      register,
      login,
      unlock,
      lock,
      logout,
      // Callers of `refresh` only care that it finished, not whether it loaded - the states
      // that a failure implies (signed out, frozen) are set by loadAll itself.
      refresh: async () => {
        await loadAll();
      },
      retryFrozen,
      addTransaction,
      updateTransaction,
      deleteTransaction,
    }),
    [
      status, me, overview, transactions, pendingApproval, loading, error, offline, lastSyncedAt,
      register, login, unlock, lock, logout, loadAll, retryFrozen, addTransaction, updateTransaction,
      deleteTransaction,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
