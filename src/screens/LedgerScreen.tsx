import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useApp } from '../state/AppContext';
import { TransactionRow } from '../components/TransactionRow';
import { ConfirmSheet, Empty, Spinner } from '../components/ui';
import { CalendarIcon, CloseIcon, PlusIcon, SearchIcon } from '../components/Icons';
import { matchesQuery, withinDateRange } from '../lib/search';
import type { Transaction } from '../lib/types';

type TypeFilter = 'all' | 'received' | 'expense';
type Scope = 'session' | 'all';

export function LedgerScreen() {
  const navigate = useNavigate();
  const { me, transactions, pendingApproval, deleteTransaction } = useApp();

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [partnerFilter, setPartnerFilter] = useState<string>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [dateOpen, setDateOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [scope, setScope] = useState<Scope>('session');
  const [allTxns, setAllTxns] = useState<Transaction[] | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Transaction | null>(null);
  const [busy, setBusy] = useState(false);

  // The Ledger shows the current session by default. A date range that cannot reach past
  // sessions would be half a feature, so searching across all of them is one tap away - and
  // it refetches whenever the live ledger changes, so a partner's new entry still shows up.
  useEffect(() => {
    if (scope !== 'all') return;
    let cancelled = false;
    setLoadingAll(true);
    api<{ transactions: Transaction[] }>('/transactions?scope=all')
      .then((data) => !cancelled && setAllTxns(data.transactions))
      .catch(() => !cancelled && setAllTxns([]))
      .finally(() => !cancelled && setLoadingAll(false));
    return () => {
      cancelled = true;
    };
  }, [scope, transactions]);

  const source = scope === 'all' ? (allTxns ?? []) : transactions;

  const visible = useMemo(
    () =>
      source.filter((txn) => {
        if (typeFilter !== 'all' && txn.type !== typeFilter) return false;
        if (partnerFilter !== 'all' && txn.ownerId !== partnerFilter) return false;
        if (!withinDateRange(txn, from, to)) return false;
        return matchesQuery(txn, query);
      }),
    [source, typeFilter, partnerFilter, from, to, query],
  );

  if (!me) return <Spinner />;

  const filtered =
    typeFilter !== 'all' || partnerFilter !== 'all' || query.trim() !== '' || from !== '' || to !== '';

  const clearAll = () => {
    setTypeFilter('all');
    setPartnerFilter('all');
    setQuery('');
    setFrom('');
    setTo('');
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await deleteTransaction(pendingDelete.id);
      setPendingDelete(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <div className="ledger-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="screen-title">Ledger</h1>
          <p className="screen-subtitle" style={{ marginBottom: 0 }}>
            {visible.length} {visible.length === 1 ? 'transaction' : 'transactions'}
            {filtered && ` of ${source.length}`}
          </p>
        </div>
        <div className="ledger-actions">
          <button
            className={`icon-toggle${searchOpen ? ' icon-toggle--on' : ''}`}
            aria-label="Search transactions"
            aria-pressed={searchOpen}
            onClick={() => {
              const next = !searchOpen;
              setSearchOpen(next);
              // Closing the panel must not leave an invisible filter applied.
              if (!next) setQuery('');
            }}
          >
            <SearchIcon size={20} />
          </button>
          <button
            className={`icon-toggle${dateOpen ? ' icon-toggle--on' : ''}`}
            aria-label="Filter by date"
            aria-pressed={dateOpen}
            onClick={() => {
              const next = !dateOpen;
              setDateOpen(next);
              if (!next) {
                setFrom('');
                setTo('');
              }
            }}
          >
            <CalendarIcon size={20} />
          </button>
        </div>
      </div>

      <div style={{ height: 14 }} />

      {searchOpen && (
        <div className="search-box">
          <SearchIcon size={19} style={{ color: 'var(--text-muted)', flex: '0 0 auto' }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes, amount or partner"
            autoFocus
            // A search field is not a form field to autocorrect - a capitalised or
            // "corrected" query silently stops matching.
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          {query && (
            <button className="icon-button" onClick={() => setQuery('')} aria-label="Clear search">
              <CloseIcon size={18} />
            </button>
          )}
        </div>
      )}

      {dateOpen && (
        <div className="filter-panel">
          <div className="date-range">
            <div>
              <label className="field-label" htmlFor="from">
                From
              </label>
              <input
                id="from"
                type="date"
                className="input"
                value={from}
                // Keeps the range coherent: you cannot set a start after the end.
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="to">
                To
              </label>
              <input
                id="to"
                type="date"
                className="input"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>

          <div className="pill-row" style={{ marginTop: 12 }}>
            <button
              className={`pill${scope === 'session' ? ' pill--active' : ''}`}
              onClick={() => setScope('session')}
            >
              This session
            </button>
            <button
              className={`pill${scope === 'all' ? ' pill--active' : ''}`}
              onClick={() => setScope('all')}
            >
              All sessions
            </button>
            {(from || to) && (
              <button
                className="pill"
                onClick={() => {
                  setFrom('');
                  setTo('');
                }}
              >
                Clear dates
              </button>
            )}
          </div>
        </div>
      )}

      {(searchOpen || dateOpen) && <div style={{ height: 12 }} />}

      <div className="pill-row">
        {(
          [
            ['all', 'All'],
            ['received', 'Received'],
            ['expense', 'Expense'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            className={`pill${typeFilter === value ? ' pill--active' : ''}`}
            onClick={() => setTypeFilter(value)}
          >
            {label}
          </button>
        ))}

        <span className="pill-divider" />

        <button
          className={`pill${partnerFilter === 'all' ? ' pill--active' : ''}`}
          onClick={() => setPartnerFilter('all')}
        >
          All partners
        </button>
        {me.partners.map((partner) => (
          <button
            key={partner.userId}
            className={`pill${partnerFilter === partner.userId ? ' pill--active' : ''}`}
            onClick={() => setPartnerFilter(partner.userId)}
          >
            {partner.name}
          </button>
        ))}
      </div>

      <div style={{ height: 14 }} />

      {loadingAll && allTxns === null ? (
        <Spinner />
      ) : visible.length === 0 ? (
        <Empty title={source.length === 0 ? 'Nothing recorded yet' : 'No matching entries'}>
          {source.length === 0 ? (
            'Tap + to record your first entry for this session.'
          ) : scope === 'session' ? (
            <>
              Nothing in this session matches.{' '}
              <button className="link-button" onClick={() => setScope('all')}>
                Search all sessions
              </button>
            </>
          ) : (
            <>
              Nothing matches.{' '}
              <button className="link-button" onClick={clearAll}>
                Clear filters
              </button>
            </>
          )}
        </Empty>
      ) : (
        visible.map((txn) => (
          <TransactionRow
            key={txn.id}
            txn={txn}
            tag={txn.sessionId !== me.session.id ? 'Past session' : undefined}
            // Entries you recorded or that are yours, and only in the session still open -
            // a settled session is history. The server enforces the same rule; the button is
            // hidden because offering an action that always fails is a worse experience, not
            // because hiding it is the safeguard.
            canDelete={
              (txn.createdById === me.user.id || txn.ownerId === me.user.id) &&
              txn.sessionId === me.session.id
            }
            onDelete={() => setPendingDelete(txn)}
            // Same rule as delete: only the partner who recorded it, or whose entry it is, and
            // only in the still-open session - a settled one is history.
            canEdit={
              (txn.createdById === me.user.id || txn.ownerId === me.user.id) &&
              txn.sessionId === me.session.id
            }
            onEdit={() => navigate(`/add/${txn.id}`)}
            pendingEdit={
              pendingApproval?.kind === 'edit_transaction' && pendingApproval.transactionId === txn.id
            }
          />
        ))
      )}

      <button className="fab" onClick={() => navigate('/add')} aria-label="Add transaction">
        <PlusIcon size={27} />
      </button>

      {pendingDelete && (
        <ConfirmSheet
          title="Move to Deleted Records?"
          body={
            <>
              This entry will leave the ledger and move to{' '}
              <strong>Settings → Deleted Records</strong>. Nothing is lost — only your partner
              can remove it permanently from there.
            </>
          }
          confirmLabel="Delete"
          busy={busy}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
