/*
 * Offline support: the last known ledger, and a lock screen that still works with no network.
 *
 * The packaged Android app carries its whole UI, so opening it on a train already shows the
 * app rather than a browser error. That alone is not much use - without this, the furthest
 * you could get is the PIN screen, because unlocking asks the server and the server is not
 * there. So two things are kept on the device: a snapshot of the last successful load, and a
 * verifier that can check a PIN locally.
 *
 * Read-only by design. Everything shown offline is what was true at `at`, labelled as such,
 * and writing is refused rather than queued - two partners editing the same ledger from two
 * phones is exactly the case where a silent replay-on-reconnect invents figures neither of
 * them entered. Reconnecting re-reads from the server, which stays the only source of truth.
 */

const SNAPSHOT_KEY = 'ledgerplus.snapshot';
const PIN_KEY = 'ledgerplus.pinCheck';
const ATTEMPTS_KEY = 'ledgerplus.offlineAttempts';

/// Same work factor as the server's PIN hashing (backend/src/services/pin.ts), so a stolen
/// device is no cheaper to attack offline than the API is online.
const PBKDF2_ITERATIONS = 100_000;

/// A phone holding two people's books should not accept unlimited PIN guesses just because it
/// happens to be in a tunnel. The server rate-limits; offline has to do it itself.
const MAX_OFFLINE_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export interface Snapshot<T> {
  /// When this was last read from the server.
  at: number;
  /// Which user it belongs to. A snapshot must never be shown to whoever signs in next.
  userId: string;
  data: T;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    // Storage disabled, quota exceeded, or a snapshot written by an older build whose shape
    // no longer parses. All of them mean the same thing: there is no usable cache.
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* over quota or storage disabled - the app works, it just will not work offline */
  }
}

// ── The cached ledger ──────────────────────────────────────────────────────

export function saveSnapshot<T>(userId: string, data: T): void {
  write(SNAPSHOT_KEY, { at: Date.now(), userId, data } satisfies Snapshot<T>);
}

export function loadSnapshot<T>(): Snapshot<T> | null {
  const snap = read<Snapshot<T>>(SNAPSHOT_KEY);
  if (!snap || typeof snap.at !== 'number' || !snap.userId || !snap.data) return null;
  return snap;
}

/// Called on logout and whenever a session is rejected. Leaving a previous partner's figures
/// on the device for the next person to unlock into would be a real leak, not an untidiness.
export function clearOfflineData(): void {
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
    localStorage.removeItem(PIN_KEY);
    localStorage.removeItem(ATTEMPTS_KEY);
  } catch {
    /* storage unavailable */
  }
}

// ── Unlocking with no network ──────────────────────────────────────────────

function bytesToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function derive(pin: string, saltHex: string): Promise<string | null> {
  // Needs a secure context. The packaged app is served over the https scheme and the web app
  // over real TLS, so this is available in both - but an http:// LAN address in dev is not,
  // and there it simply means no offline unlock rather than a crash.
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  try {
    const salt = Uint8Array.from(saltHex.match(/.{2}/g) ?? [], (b) => parseInt(b, 16));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
      'deriveBits',
    ]);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      key,
      256,
    );
    return bytesToHex(bits);
  } catch {
    return null;
  }
}

/// Records what the PIN is, without recording the PIN.
///
/// Called only after the SERVER has accepted it, so this can never disagree with the real
/// one. It stores a PBKDF2 verifier, not the PIN, and it does not weaken anything that was
/// not already true: this device is already holding a session token that grants the same
/// access, so the token is the thing worth protecting, and the lock screen's job is to stop a
/// person who has picked up an unlocked phone - which this does exactly as well offline.
export async function savePinVerifier(pin: string): Promise<void> {
  const salt = new Uint8Array(16);
  try {
    crypto.getRandomValues(salt);
  } catch {
    return;
  }
  const saltHex = bytesToHex(salt.buffer);
  const hash = await derive(pin, saltHex);
  if (hash) write(PIN_KEY, `${saltHex}:${hash}`);
}

export function hasPinVerifier(): boolean {
  return typeof read<string>(PIN_KEY) === 'string';
}

interface Attempts {
  count: number;
  until: number;
}

/// Milliseconds remaining on an offline lockout, or 0 if there is none.
export function offlineLockoutRemaining(): number {
  const a = read<Attempts>(ATTEMPTS_KEY);
  if (!a || typeof a.until !== 'number') return 0;
  return Math.max(0, a.until - Date.now());
}

export type OfflineUnlockResult = 'ok' | 'wrong-pin' | 'locked-out' | 'unavailable';

/// Checks a PIN against the stored verifier. Never contacts the server.
export async function tryOfflineUnlock(pin: string): Promise<OfflineUnlockResult> {
  if (offlineLockoutRemaining() > 0) return 'locked-out';

  const stored = read<string>(PIN_KEY);
  if (typeof stored !== 'string' || !stored.includes(':')) return 'unavailable';
  const [saltHex, expected] = stored.split(':');

  const actual = await derive(pin, saltHex);
  if (actual === null) return 'unavailable';

  if (actual === expected) {
    try {
      localStorage.removeItem(ATTEMPTS_KEY);
    } catch {
      /* storage unavailable */
    }
    return 'ok';
  }

  const previous = read<Attempts>(ATTEMPTS_KEY);
  const count = (previous?.count ?? 0) + 1;
  write(ATTEMPTS_KEY, {
    count,
    until: count >= MAX_OFFLINE_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0,
  } satisfies Attempts);
  return count >= MAX_OFFLINE_ATTEMPTS ? 'locked-out' : 'wrong-pin';
}

// ── Connectivity ───────────────────────────────────────────────────────────

/// navigator.onLine only knows whether there is a network interface, not whether anything is
/// reachable across it - a phone on captive-portal wifi reports true. It is used as a hint
/// for reacting quickly to reconnection, never as the thing that decides we are offline; that
/// decision comes from a request actually failing.
export function onConnectivityChange(fn: () => void): () => void {
  window.addEventListener('online', fn);
  return () => window.removeEventListener('online', fn);
}
