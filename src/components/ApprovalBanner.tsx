import { useState } from 'react';
import { api, ApiError } from '../api/client';
import { useApp } from '../state/AppContext';
import { ErrorText } from './ui';
import { formatDateTime, formatRupees } from '../lib/format';
import type { PendingApproval } from '../lib/types';

/// The one thing on Home that outranks the balances: a change your partner is waiting on you
/// to agree to. Deliberately loud - a request nobody notices is the same as a broken feature,
/// because the partnership's session simply never closes.
export function ApprovalBanner({ approval }: { approval: PendingApproval }) {
  const { refresh } = useApp();
  const [busy, setBusy] = useState<'approve' | 'reject' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (action: 'approve' | 'reject' | 'cancel') => {
    setBusy(action);
    setError(null);
    try {
      await api(`/approvals/${approval.id}/${action}`, { method: 'POST' });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not complete that.');
      // The request may have been decided on the other device in the meantime; a refresh
      // clears the banner rather than leaving a stale one on screen.
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const p = approval.payload;

  const title =
    approval.kind === 'close_session'
      ? `Start a fresh session (close #${String(p.sessionSeq ?? 0).padStart(3, '0')})`
      : approval.kind === 'mark_paid'
        ? `Confirm payment for ${p.settlementLabel ?? 'a settlement'}`
        : approval.kind === 'edit_transaction'
          ? 'Edit an entry'
          : `Add an entry to ${p.settlementLabel ?? 'a settled session'}`;

  const body =
    approval.kind === 'close_session' ? (
      <>
        {p.transactionCount} {p.transactionCount === 1 ? 'entry' : 'entries'} will be settled and
        archived, then a new session starts from ₹0. Nothing is deleted.
      </>
    ) : approval.kind === 'mark_paid' ? (
      <>
        {approval.requestedByName} says <strong>{formatRupees(Number(p.amount ?? 0))}</strong> has
        been paid from {p.fromUserName} to {p.toUserName}. Approving records that the money
        actually changed hands.
      </>
    ) : approval.kind === 'edit_transaction' ? (
      <>
        {p.original?.category} · <strong>{formatRupees(Number(p.original?.amount ?? 0))}</strong>{' '}
        on {p.original?.date} will change to {p.proposed?.type === 'received' ? 'Received' : 'Expense'}{' '}
        · {p.proposed?.category} ·{' '}
        <strong>{formatRupees(Number(p.proposed?.amount ?? 0))}</strong> on {p.proposed?.date}
        {p.proposed?.notes ? ` — ${p.proposed.notes}` : ''}.
      </>
    ) : (
      <>
        {p.type === 'received' ? 'Received' : 'Expense'} · {p.category} ·{' '}
        <strong>{formatRupees(Number(p.amount ?? 0))}</strong> on {p.date}
        {p.notes ? ` — ${p.notes}` : ''}. The settlement figures will be recalculated.
      </>
    );

  return (
    <div className="approval">
      <div className="approval-tag">{approval.isMine ? 'Waiting for your partner' : 'Needs your approval'}</div>

      <div className="approval-title">{title}</div>

      <div className="approval-body">{body}</div>

      <div className="approval-meta">
        Asked by {approval.requestedByName} · {formatDateTime(approval.requestedAt)}
      </div>

      <ErrorText>{error}</ErrorText>

      {approval.isMine ? (
        <button className="btn btn--ghost btn--sm" onClick={() => act('cancel')} disabled={busy !== null}>
          {busy === 'cancel' ? 'Withdrawing…' : 'Withdraw request'}
        </button>
      ) : (
        <div className="btn-row">
          <button className="btn btn--ghost btn--sm" onClick={() => act('reject')} disabled={busy !== null}>
            {busy === 'reject' ? 'Rejecting…' : 'Reject'}
          </button>
          <button className="btn btn--green btn--sm" onClick={() => act('approve')} disabled={busy !== null}>
            {busy === 'approve' ? 'Approving…' : 'Approve'}
          </button>
        </div>
      )}
    </div>
  );
}
