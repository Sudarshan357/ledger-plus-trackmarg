import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { ConfirmSheet, Empty, ErrorText, PageHead, SectionLabel, Spinner } from '../../components/ui';
import { CheckCircleIcon, ChevronRightIcon, PlusIcon } from '../../components/Icons';
import { TransactionRow } from '../../components/TransactionRow';
import { ApprovalBanner } from '../../components/ApprovalBanner';
import { useApp } from '../../state/AppContext';
import { categoriesFor } from '../../lib/categories';
import {
  formatDateShort,
  formatDateTime,
  formatRupees,
  formatSignedFull,
  todayIso,
} from '../../lib/format';
import type { Settlement, TxnType } from '../../lib/types';

/// Historical settlements. The figures shown are the stored snapshot, never a fresh
/// calculation from the live ledger - so a past settlement cannot shift because something in
/// the current session did. It can still be corrected, but only deliberately: see AmendForm.
export function SettlementListScreen() {
  const navigate = useNavigate();
  const [settlements, setSettlements] = useState<Settlement[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ settlements: Settlement[] }>('/settlement/history')
      .then((data) => !cancelled && setSettlements(data.settlements))
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Could not load settlements.');
        setSettlements([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <PageHead title="Settlement Details" />
      <div className="screen screen--nonav" style={{ paddingTop: 16 }}>
        <p style={{ color: 'var(--text-muted)', fontSize: 15, marginTop: 0 }}>
          Every settled session is archived here in full. Nothing is removed when a fresh
          session starts.
        </p>

        <ErrorText>{error}</ErrorText>

        {settlements === null ? (
          <Spinner />
        ) : settlements.length === 0 ? (
          <Empty title="No settlements yet">
            When you record a settlement and start a fresh session, the closed session is
            archived here.
          </Empty>
        ) : (
          settlements.map((settlement) => (
            <button
              key={settlement.id}
              className="settle-card"
              style={{ marginBottom: 10 }}
              onClick={() => navigate(`/settings/settlements/${settlement.id}`)}
            >
              <span className="settle-text">
                <span className="settle-who">{settlement.label}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 14, display: 'block' }}>
                  {formatDateShort(settlement.startedAt)} – {formatDateShort(settlement.closedAt)}
                </span>
                <span style={{ fontSize: 14, display: 'block', marginTop: 2 }}>
                  {settlement.fromUserName
                    ? `${settlement.fromUserName} → ${settlement.toUserName}`
                    : 'All square'}
                </span>
                <span className="settle-amount">
                  {formatRupees(settlement.amount)}
                  {settlement.paid && (
                    <span className="badge badge--ok" style={{ marginLeft: 8 }}>Paid</span>
                  )}
                  {settlement.amended && (
                    <span className="badge badge--warn" style={{ marginLeft: 6 }}>Amended</span>
                  )}
                </span>
              </span>
              <ChevronRightIcon className="row-chevron" />
            </button>
          ))
        )}
      </div>
    </>
  );
}

export function SettlementDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const { me, refresh, pendingApproval } = useApp();
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmUnpaid, setConfirmUnpaid] = useState(false);
  const [adding, setAdding] = useState(false);

  const reload = async () => {
    const data = await api<{ settlement: Settlement }>(`/settlement/history/${id}`);
    setSettlement(data.settlement);
  };

  useEffect(() => {
    let cancelled = false;
    api<{ settlement: Settlement }>(`/settlement/history/${id}`)
      .then((data) => !cancelled && setSettlement(data.settlement))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : 'Not found.'));
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Confirming the payment asks the other partner; withdrawing it does not. Marking paid is
  // a claim about the real world that only they can verify, whereas un-marking just returns
  // the settlement to "not yet paid" - the conservative direction, so it needs no permission.
  const requestPaid = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/approvals/mark-paid', { method: 'POST', body: { settlementId: id } });
      await reload();
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send that request.');
    } finally {
      setBusy(false);
    }
  };

  const clearPaid = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/settlement/history/${id}/paid`, { method: 'DELETE' });
      await reload();
      await refresh();
      setConfirmUnpaid(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update.');
    } finally {
      setBusy(false);
    }
  };

  if (error && !settlement) {
    return (
      <>
        <PageHead title="Settlement" />
        <div className="screen screen--nonav">
          <Empty title="Could not load this settlement">{error}</Empty>
        </div>
      </>
    );
  }

  if (!settlement) {
    return (
      <>
        <PageHead title="Settlement" />
        <Spinner />
      </>
    );
  }

  const summary = settlement.summary;
  const isSquare = settlement.amount === 0 || !settlement.fromUserName;
  const needsApproval = (me?.partners.length ?? 0) >= 2;
  const awaitingPaidApproval =
    pendingApproval?.kind === 'mark_paid' && pendingApproval.settlementId === settlement.id;

  return (
    <>
      <PageHead title={settlement.label} />
      <div className="screen screen--nonav" style={{ paddingTop: 16 }}>
        {pendingApproval && pendingApproval.settlementId === settlement.id && (
          <div style={{ marginBottom: 14 }}>
            <ApprovalBanner approval={pendingApproval} />
          </div>
        )}

        <ErrorText>{error}</ErrorText>

        {/* Payment status, first thing on the screen. Whether the money actually moved is the
            question someone opens an old settlement to answer. */}
        {settlement.paid ? (
          <button
            className="paid-banner"
            style={{ width: '100%', textAlign: 'left' }}
            onClick={() => setConfirmUnpaid(true)}
          >
            <span className="paid-tick">
              <CheckCircleIcon size={22} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="paid-title" style={{ display: 'block' }}>Payment done</span>
              <span className="paid-sub">
                Marked by{' '}
                {summary.partners.find((p) => p.userId === settlement.paidById)?.name ?? 'a partner'}
                {settlement.paidAt ? ` · ${formatDateTime(settlement.paidAt)}` : ''}
              </span>
            </span>
          </button>
        ) : isSquare ? (
          <span className="badge">Nothing to transfer</span>
        ) : awaitingPaidApproval ? (
          <div className="badge badge--warn" style={{ display: 'block', padding: '10px 14px' }}>
            Waiting for your partner to confirm this payment
          </div>
        ) : (
          <button
            className="btn btn--green"
            onClick={requestPaid}
            disabled={busy || pendingApproval !== null}
          >
            <CheckCircleIcon size={20} />{' '}
            {busy ? 'Sending…' : `Settle ${formatRupees(settlement.amount)}`}
          </button>
        )}
        {!settlement.paid && !isSquare && needsApproval && !awaitingPaidApproval && (
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '8px 2px 0' }}>
            Your partner confirms this before it is recorded as paid.
          </p>
        )}

        <div className="card" style={{ textAlign: 'center', marginTop: 12, padding: '20px 16px' }}>
          {!isSquare ? (
            <>
              <div style={{ fontSize: 18, fontWeight: 700 }}>
                {settlement.fromUserName} <span style={{ color: 'var(--text-muted)' }}>→</span>{' '}
                {settlement.toUserName}
              </div>
              <div style={{ fontSize: 32, fontWeight: 800, marginTop: 4 }}>
                {formatRupees(settlement.amount)}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 20, fontWeight: 800 }}>All square</div>
          )}
          <p style={{ color: 'var(--text-muted)', margin: '8px 0 0', fontSize: 14 }}>
            {formatDateShort(settlement.startedAt)} – {formatDateShort(settlement.closedAt)}
          </p>
          {settlement.amended && (
            // An amended figure must never pass for the one both partners originally agreed to.
            <p style={{ color: 'var(--warn-fg)', margin: '10px 0 0', fontSize: 13, fontWeight: 600 }}>
              Amended {settlement.amendmentCount}{' '}
              {settlement.amendmentCount === 1 ? 'time' : 'times'}
              {settlement.originalAmount !== null &&
                ` · was ${formatRupees(settlement.originalAmount)}`}
              {settlement.amendedAt ? ` · ${formatDateShort(settlement.amendedAt)}` : ''}
            </p>
          )}
        </div>

        <div className="stat-grid" style={{ marginTop: 12 }}>
          <div className="stat">
            <div className="stat-label">Received</div>
            <div className="stat-value amount--in">{formatRupees(settlement.totalReceived)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Expenses</div>
            <div className="stat-value amount--out">{formatRupees(settlement.totalExpense)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Profit</div>
            <div className="stat-value">{formatRupees(settlement.totalProfit)}</div>
          </div>
        </div>

        <SectionLabel>Per partner</SectionLabel>
        {summary.partners.map((partner) => (
          <div className="card" key={partner.userId}>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>{partner.name}</div>
            <DetailLine label="Total income" value={formatRupees(partner.received)} tone="in" />
            <DetailLine label="Total expenses" value={formatRupees(partner.expense)} tone="out" />
            <DetailLine label="Net" value={formatRupees(partner.net)} />
            <DetailLine
              label="Share balance"
              value={formatSignedFull(partner.shareBalance)}
              tone={partner.shareBalance >= 0 ? 'in' : 'out'}
            />
          </div>
        ))}

        <SectionLabel>Transactions in this session ({summary.transactionCount})</SectionLabel>
        {summary.transactions.map((txn) => (
          <TransactionRow key={txn.id} txn={txn} />
        ))}

        {adding ? (
          <AmendForm
            settlementId={settlement.id}
            needsApproval={needsApproval}
            onCancel={() => setAdding(false)}
            onDone={async () => {
              setAdding(false);
              await reload();
              await refresh();
            }}
            onError={setError}
          />
        ) : (
          <button
            className="btn btn--ghost"
            style={{ marginTop: 12 }}
            onClick={() => setAdding(true)}
            disabled={pendingApproval !== null}
          >
            <PlusIcon size={19} /> Add entry to this settlement
          </button>
        )}

        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 18 }}>
          Settled by {summary.closedByName} on {formatDateTime(settlement.closedAt)}. Share per
          partner: {formatRupees(settlement.sharePerPartner)}. Adding an entry here recalculates
          this settlement{needsApproval ? ' once your partner approves it' : ''}.
        </p>
      </div>

      {confirmUnpaid && (
        <ConfirmSheet
          title="Mark this as unpaid?"
          body="This removes the payment confirmation. Your partner will see that it was marked paid and then undone."
          confirmLabel="Mark unpaid"
          busy={busy}
          onConfirm={clearPaid}
          onCancel={() => setConfirmUnpaid(false)}
        />
      )}
    </>
  );
}

/// Adds a forgotten entry to a settled session. With two partners this sends a request rather
/// than writing directly - changing a settlement both of them agreed to is at least as
/// consequential as closing one.
function AmendForm({
  settlementId,
  needsApproval,
  onCancel,
  onDone,
  onError,
}: {
  settlementId: string;
  needsApproval: boolean;
  onCancel: () => void;
  onDone: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const { me } = useApp();
  const [type, setType] = useState<TxnType>('expense');
  const [category, setCategory] = useState(categoriesFor('expense')[0]);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [ownerId, setOwnerId] = useState(me?.user.id ?? '');
  const [busy, setBusy] = useState(false);

  const value = Number(amount);
  const canSave = amount !== '' && Number.isFinite(value) && value > 0 && !busy;

  const chooseType = (next: TxnType) => {
    setType(next);
    setCategory(categoriesFor(next)[0]);
  };

  const submit = async () => {
    if (!canSave) return;
    setBusy(true);
    onError(null);
    try {
      await api('/approvals/amend-settlement', {
        method: 'POST',
        body: { settlementId, type, category, amount: value, date, notes: notes.trim(), ownerId },
      });
      await onDone();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not add that entry.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="type-toggle" style={{ marginBottom: 16 }}>
        <button className="type-in" aria-pressed={type === 'received'} onClick={() => chooseType('received')}>
          Received
        </button>
        <button className="type-out" aria-pressed={type === 'expense'} onClick={() => chooseType('expense')}>
          Expense
        </button>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="amend-amount">Amount</label>
        <div className="amount-input" style={{ padding: '12px 14px' }}>
          <span style={{ fontSize: 22 }}>₹</span>
          <input
            id="amend-amount"
            inputMode="decimal"
            value={amount}
            placeholder="0"
            style={{ fontSize: 22 }}
            onChange={(e) => {
              const next = e.target.value.replace(/[^0-9.]/g, '');
              if (/^[0-9]*\.?[0-9]{0,2}$/.test(next)) setAmount(next);
            }}
          />
        </div>
      </div>

      <div className="field">
        <span className="field-label">Category</span>
        <div className="pill-row">
          {categoriesFor(type).map((option) => (
            <button
              key={option}
              className={`pill${category === option ? ' pill--active' : ''}`}
              onClick={() => setCategory(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Partner</span>
        <div className="pill-row">
          {(me?.partners ?? []).map((partner) => (
            <button
              key={partner.userId}
              className={`pill${ownerId === partner.userId ? ' pill--active' : ''}`}
              onClick={() => setOwnerId(partner.userId)}
            >
              {partner.name}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="amend-date">Date</label>
        <input
          id="amend-date"
          type="date"
          className="input"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="amend-notes">Notes (optional)</label>
        <input
          id="amend-notes"
          className="input"
          value={notes}
          maxLength={500}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Job details, invoice #, etc."
        />
      </div>

      <div className="btn-row">
        <button className="btn btn--ghost btn--sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn--sm" onClick={submit} disabled={!canSave}>
          {busy ? 'Sending…' : needsApproval ? 'Send for approval' : 'Add entry'}
        </button>
      </div>
    </div>
  );
}

function DetailLine({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'in' | 'out';
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span
        className={tone === 'in' ? 'amount--in' : tone === 'out' ? 'amount--out' : undefined}
        style={{ fontWeight: 700 }}
      >
        {value}
      </span>
    </div>
  );
}
