import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  getSupportToken,
  grantUnlock,
  setSupportToken,
  setToken,
  supportApi,
} from '../api/client';
import { Avatar, ConfirmSheet, Empty, ErrorText, SectionLabel, Spinner } from '../components/ui';
import { ChevronLeftIcon, ChevronRightIcon, SnowflakeIcon } from '../components/Icons';
import { formatDateShort, formatDateTime, formatRupees } from '../lib/format';

// Operator-facing, not client-facing. It is reached only at #/support, is never linked from
// anywhere in the app, and the whole surface 404s unless LEDGER_SUPPORT_PASSWORD is set on the
// server. It deliberately looks different from the client app so it is obvious at a glance
// which one you are looking at.

interface SupportPartner {
  userId: string;
  name: string;
  phone: string;
  initials: string;
  partnerCode: string;
  role: string;
  active: boolean;
  joinedAt: string;
}

interface Partnership {
  groupId: string;
  name: string;
  code: string;
  displayCode: string;
  frozen: boolean;
  createdAt: string;
  sessionSeq: number | null;
  transactionCount: number;
  settlementCount: number;
  totalProfit: number;
  partners: SupportPartner[];
}

interface AuditEntry {
  id: string;
  action: string;
  userName: string;
  details: unknown;
  createdAt: string;
}

export function SupportConsole() {
  const [authed, setAuthed] = useState(() => Boolean(getSupportToken()));
  const [partnerships, setPartnerships] = useState<Partnership[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await supportApi<{ partnerships: Partnership[] }>('/partnerships');
      setPartnerships(data.partnerships);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSupportToken(null);
        setAuthed(false);
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Could not load partnerships.');
      setPartnerships([]);
    }
  }, []);

  useEffect(() => {
    if (authed) void load();
  }, [authed, load]);

  if (!authed) return <SupportLogin onDone={() => setAuthed(true)} />;

  const current = partnerships?.find((p) => p.groupId === selected) ?? null;

  return (
    <div className="support">
      <header className="support-bar">
        <div>
          <div className="support-title">Ledger+ Support</div>
          <div className="support-sub">
            {current ? current.name : `${partnerships?.length ?? 0} partnerships`}
          </div>
        </div>
        <button
          className="support-signout"
          onClick={() => {
            setSupportToken(null);
            setAuthed(false);
            setSelected(null);
          }}
        >
          Sign out
        </button>
      </header>

      <div className="screen screen--nonav">
        <ErrorText>{error}</ErrorText>

        {partnerships === null ? (
          <Spinner />
        ) : current ? (
          <PartnershipDetail
            partnership={current}
            onBack={() => setSelected(null)}
            onChanged={load}
            onError={setError}
          />
        ) : partnerships.length === 0 ? (
          <Empty title="No partnerships yet">
            Ledger+ groups appear here as soon as someone registers.
          </Empty>
        ) : (
          partnerships.map((p) => (
            <button key={p.groupId} className="settle-card" style={{ marginBottom: 10 }} onClick={() => setSelected(p.groupId)}>
              <span className="settle-text">
                <span className="settle-who">{p.name}</span>
                <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: 14 }}>
                  {p.displayCode} · {p.partners.length} partner{p.partners.length === 1 ? '' : 's'} ·
                  {' '}Session #{String(p.sessionSeq ?? 0).padStart(3, '0')}
                </span>
                <span style={{ display: 'block', fontSize: 14, marginTop: 2 }}>
                  {p.transactionCount} entries · profit {formatRupees(p.totalProfit)}
                  {p.frozen && <span className="badge badge--warn" style={{ marginLeft: 8 }}>Frozen</span>}
                </span>
              </span>
              <ChevronRightIcon className="row-chevron" />
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ── Password gate ───────────────────────────────────────────────────────────

function SupportLogin({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await supportApi<{ token: string }>('/login', { method: 'POST', body: { password } });
      setSupportToken(res.token);
      onDone();
    } catch (err) {
      // A 404 means the console is switched off server-side, which is a different problem
      // from a wrong password and deserves a different message.
      setError(
        err instanceof ApiError && err.status === 404
          ? 'The support console is not enabled on this server. Set LEDGER_SUPPORT_PASSWORD and restart.'
          : err instanceof ApiError
            ? err.message
            : 'Could not sign in.',
      );
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <h1 className="auth-logo">Support</h1>
      <p className="auth-tag">Ledger+ operator console.</p>

      <ErrorText>{error}</ErrorText>

      <div className="field">
        <label className="field-label" htmlFor="pw">
          Support password
        </label>
        <input
          id="pw"
          className="input"
          type="password"
          value={password}
          autoFocus
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && password && void submit()}
        />
      </div>

      <button className="btn" onClick={submit} disabled={busy || !password}>
        {busy ? 'Checking…' : 'Sign in'}
      </button>
    </div>
  );
}

// ── One partnership ─────────────────────────────────────────────────────────

function PartnershipDetail({
  partnership,
  onBack,
  onChanged,
  onError,
}: {
  partnership: Partnership;
  onBack: () => void;
  onChanged: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [name, setName] = useState(partnership.name);
  const [code, setCode] = useState(partnership.displayCode);
  const [savingGroup, setSavingGroup] = useState(false);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [impersonating, setImpersonating] = useState<SupportPartner | null>(null);
  const [confirmFreeze, setConfirmFreeze] = useState<boolean | null>(null);
  const [freezing, setFreezing] = useState(false);

  useEffect(() => {
    setName(partnership.name);
    setCode(partnership.displayCode);
  }, [partnership.groupId, partnership.name, partnership.displayCode]);

  useEffect(() => {
    supportApi<{ entries: AuditEntry[] }>(`/partnerships/${partnership.groupId}/audit`)
      .then((d) => setAudit(d.entries))
      .catch(() => setAudit([]));
  }, [partnership.groupId]);

  const saveGroup = async () => {
    setSavingGroup(true);
    onError(null);
    try {
      await supportApi(`/partnerships/${partnership.groupId}`, { method: 'PATCH', body: { name, code } });
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setSavingGroup(false);
    }
  };

  const openAccount = async () => {
    if (!impersonating) return;
    try {
      const res = await supportApi<{ token: string }>('/impersonate', {
        method: 'POST',
        body: { userId: impersonating.userId },
      });
      // Become this partner: store their real session token, skip the lock screen once, and
      // hard-reload out of the console so the app boots exactly as it would for them.
      setToken(res.token);
      grantUnlock();
      window.location.replace('/');
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not open that account.');
      setImpersonating(null);
    }
  };

  const setFrozen = async (frozen: boolean) => {
    setFreezing(true);
    onError(null);
    try {
      await supportApi(`/partnerships/${partnership.groupId}/frozen`, {
        method: 'PATCH',
        body: { frozen },
      });
      await onChanged();
      setConfirmFreeze(null);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not change that.');
    } finally {
      setFreezing(false);
    }
  };

  const dirty = name !== partnership.name || code !== partnership.displayCode;

  return (
    <>
      <button className="link-button" onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 14 }}>
        <ChevronLeftIcon size={18} /> All partnerships
      </button>

      {partnership.frozen && (
        <div className="card" style={{ borderColor: 'var(--warn-fg)', marginBottom: 12 }}>
          <div style={{ fontWeight: 800 }}>This partnership is frozen</div>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '4px 0 0' }}>
            Both partners are locked out of the ledger. They can still sign out; nothing has
            been deleted.
          </p>
        </div>
      )}

      <div className="card">
        <div className="field">
          <label className="field-label" htmlFor="bn">Business name</label>
          <input id="bn" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 8 }}>
          <label className="field-label" htmlFor="gc">Group code</label>
          <input
            id="gc"
            className="input"
            value={code}
            autoCapitalize="characters"
            spellCheck={false}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <p className="owner-note">
            Both partners sign in with this code. Changing it signs nobody out, but they will
            need the new code next time.
          </p>
        </div>
        <button className="btn btn--sm" onClick={saveGroup} disabled={!dirty || savingGroup}>
          {savingGroup ? 'Saving…' : 'Save changes'}
        </button>

        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <button
            className={partnership.frozen ? 'btn btn--green btn--sm' : 'btn btn--red btn--sm'}
            onClick={() => setConfirmFreeze(!partnership.frozen)}
            disabled={freezing}
          >
            <SnowflakeIcon size={18} />{' '}
            {partnership.frozen ? 'Unfreeze account' : 'Freeze account'}
          </button>
        </div>
      </div>

      <div className="stat-grid" style={{ marginTop: 12 }}>
        <div className="stat">
          <div className="stat-label">Entries</div>
          <div className="stat-value">{partnership.transactionCount}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Settled</div>
          <div className="stat-value">{partnership.settlementCount}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Since</div>
          <div className="stat-value" style={{ fontSize: 14 }}>
            {formatDateShort(partnership.createdAt)}
          </div>
        </div>
      </div>

      <SectionLabel>Partners</SectionLabel>
      {partnership.partners.map((partner) => (
        <PartnerCard
          key={partner.userId}
          partner={partner}
          onOpen={() => setImpersonating(partner)}
          onChanged={onChanged}
          onError={onError}
        />
      ))}

      <SectionLabel>Recent activity</SectionLabel>
      {audit === null ? (
        <Spinner />
      ) : audit.length === 0 ? (
        <Empty title="Nothing recorded yet" />
      ) : (
        <div className="card-list">
          {audit.slice(0, 15).map((entry) => (
            <div className="row" key={entry.id} style={{ display: 'block' }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>
                {entry.action}
                {entry.action.startsWith('support.') && (
                  <span className="badge badge--warn" style={{ marginLeft: 8 }}>support</span>
                )}
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                {entry.userName} · {formatDateTime(entry.createdAt)}
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmFreeze !== null && (
        <ConfirmSheet
          title={confirmFreeze ? 'Freeze this partnership?' : 'Unfreeze this partnership?'}
          body={
            confirmFreeze ? (
              <>
                Both partners will immediately be locked out of <strong>{partnership.name}</strong>{' '}
                and shown the frozen notice. Any device they have open locks at once. Nothing is
                deleted, and you can lift this at any time.
              </>
            ) : (
              <>
                <strong>{partnership.name}</strong> will regain full access straight away, on
                every device they have open.
              </>
            )
          }
          confirmLabel={confirmFreeze ? 'Freeze account' : 'Unfreeze'}
          tone={confirmFreeze ? 'danger' : 'green'}
          busy={freezing}
          onConfirm={() => setFrozen(confirmFreeze)}
          onCancel={() => setConfirmFreeze(null)}
        />
      )}

      {impersonating && (
        <ConfirmSheet
          title={`Open ${impersonating.name}'s account?`}
          body={
            <>
              You will be signed in as <strong>{impersonating.name}</strong> with full access to
              this partnership's ledger. This is recorded in their audit trail. Your support
              session stays signed in on this tab.
            </>
          }
          confirmLabel="Open account"
          tone="primary"
          onConfirm={openAccount}
          onCancel={() => setImpersonating(null)}
        />
      )}
    </>
  );
}

// ── One partner, with the two credential actions ────────────────────────────

function PartnerCard({
  partner,
  onOpen,
  onChanged,
  onError,
}: {
  partner: SupportPartner;
  onOpen: () => void;
  onChanged: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [editing, setEditing] = useState<'phone' | 'pin' | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const start = (mode: 'phone' | 'pin') => {
    setEditing(mode);
    setValue(mode === 'phone' ? partner.phone : '');
    setDone(null);
    onError(null);
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    onError(null);
    try {
      await supportApi(`/partners/${partner.userId}/${editing}`, {
        method: 'PATCH',
        body: editing === 'phone' ? { phone: value } : { pin: value },
      });
      setDone(
        editing === 'phone'
          ? 'Phone number updated.'
          : 'PIN reset. They have been signed out on every device.',
      );
      setEditing(null);
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const valid =
    editing === 'phone' ? /^[0-9]{10,15}$/.test(value) : /^[0-9]{4,6}$/.test(value);

  return (
    <div className="card">
      <div className="partner-head">
        <Avatar initials={partner.initials} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="partner-name">{partner.name}</div>
          <div className="partner-net">
            {partner.phone} · {partner.partnerCode} · {partner.role}
          </div>
        </div>
      </div>

      {done && (
        <p style={{ color: 'var(--green)', fontSize: 14, margin: '10px 0 0', fontWeight: 600 }}>{done}</p>
      )}

      {editing ? (
        <div style={{ marginTop: 12 }}>
          <label className="field-label" htmlFor={`${partner.userId}-${editing}`}>
            {editing === 'phone' ? 'New phone number' : 'New PIN (4-6 digits)'}
          </label>
          <input
            id={`${partner.userId}-${editing}`}
            className="input"
            inputMode="numeric"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && valid && void save()}
          />
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button className="btn btn--ghost btn--sm" onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </button>
            <button className="btn btn--sm" onClick={save} disabled={!valid || busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <div className="support-actions">
          <button className="pill" onClick={() => start('phone')}>Change phone</button>
          <button className="pill" onClick={() => start('pin')}>Reset PIN</button>
          <button className="pill pill--active" onClick={onOpen}>Open account</button>
        </div>
      )}
    </div>
  );
}
