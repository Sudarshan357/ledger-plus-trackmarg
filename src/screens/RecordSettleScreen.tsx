import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useApp } from '../state/AppContext';
import { ConfirmSheet, Empty, ErrorText, PageHead, SectionLabel, Spinner } from '../components/ui';
import { formatRupees, formatSignedFull } from '../lib/format';
import { ApprovalBanner } from '../components/ApprovalBanner';
import type { Overview } from '../lib/types';

export function RecordSettleScreen() {
  const navigate = useNavigate();
  const { me, refresh, pendingApproval } = useApp();
  const [preview, setPreview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<Overview>('/settlement/preview')
      .then((data) => !cancelled && setPreview(data))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : 'Could not load.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const startFresh = async () => {
    setBusy(true);
    setError(null);
    try {
      // 202 means it is now waiting on the other partner; 201 means there was nobody to ask
      // (a one-person partnership) and it has already happened.
      const res = await api<{ applied: boolean }>('/approvals/close-session', { method: 'POST' });
      await refresh();
      setConfirming(false);
      if (res.applied) navigate('/settings/settlements', { replace: true });
      else navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start a fresh session.');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <>
        <PageHead title="Record Settle" />
        <Spinner />
      </>
    );
  }

  if (!preview) {
    return (
      <>
        <PageHead title="Record Settle" />
        <div className="screen screen--nonav">
          <Empty title="Could not load the settlement">{error}</Empty>
        </div>
      </>
    );
  }

  const settled = preview.amount === 0 || !preview.from || !preview.to;
  // With two partners this is a request, not an action - so the button and the confirmation
  // should say so rather than implying it happens on the spot.
  const needsApproval = (me?.partners.length ?? 0) >= 2;

  return (
    <>
      <PageHead title="Record Settle" />

      <div className="screen screen--nonav" style={{ paddingTop: 18 }}>
        {pendingApproval && (
          <div style={{ marginBottom: 14 }}>
            <ApprovalBanner approval={pendingApproval} />
          </div>
        )}

        {/* The result first and largest: who pays whom, and how much. Everything below it is
            the working that produced this number. */}
        <div className="card" style={{ textAlign: 'center', padding: '22px 16px' }}>
          {settled ? (
            <>
              <div className="section-label" style={{ margin: '0 0 6px' }}>
                Settlement
              </div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>All square</div>
              <p style={{ color: 'var(--text-muted)', margin: '6px 0 0' }}>
                Both partners are holding an equal share of this session.
              </p>
            </>
          ) : (
            <>
              <div className="section-label" style={{ margin: '0 0 8px' }}>
                Settlement
              </div>
              <div style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.35 }}>
                {preview.from!.name} <span style={{ color: 'var(--text-muted)' }}>→</span>{' '}
                {preview.to!.name}
              </div>
              <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.025em', marginTop: 6 }}>
                {formatRupees(preview.amount)}
              </div>
              <p style={{ color: 'var(--text-muted)', margin: '8px 0 0', fontSize: 14 }}>
                {preview.from!.name} pays {preview.to!.name} to settle Session #
                {String(preview.session.seq).padStart(3, '0')}.
              </p>
            </>
          )}
        </div>

        <div className="stat-grid" style={{ marginTop: 12 }}>
          <div className="stat">
            <div className="stat-label">Received</div>
            <div className="stat-value amount--in">{formatRupees(preview.totalReceived)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Expenses</div>
            <div className="stat-value amount--out">{formatRupees(preview.totalExpense)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Profit</div>
            <div className="stat-value">{formatRupees(preview.totalProfit)}</div>
          </div>
        </div>

        <SectionLabel>Partner breakdown</SectionLabel>

        {preview.partners.map((partner) => (
          <div className="card" key={partner.userId}>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>{partner.name}</div>
            <Line label="Total income" value={formatRupees(partner.received)} tone="in" />
            <Line label="Total expenses" value={formatRupees(partner.expense)} tone="out" />
            <Line label="Net" value={formatRupees(partner.net)} strong />
            <Line
              label="Share balance"
              value={formatSignedFull(partner.shareBalance)}
              tone={partner.shareBalance >= 0 ? 'in' : 'out'}
              strong
            />
          </div>
        ))}

        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 16 }}>
          Each partner is entitled to an equal share of the profit ({' '}
          {formatRupees(preview.sharePerPartner)} each). The share balance is what a partner is
          holding above or below that share.
        </p>

        <ErrorText>{error}</ErrorText>
      </div>

      <div className="sticky-footer">
        <div className="btn-row">
          <button className="btn btn--ghost" onClick={() => navigate(-1)}>
            Close
          </button>
          <button
            className="btn btn--green"
            onClick={() => setConfirming(true)}
            disabled={preview.transactionCount === 0 || pendingApproval !== null}
          >
            {needsApproval ? 'Request Fresh Session' : 'Start Fresh Session'}
          </button>
        </div>
        {preview.transactionCount === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', marginBottom: 0 }}>
            Add an entry before settling this session.
          </p>
        )}
      </div>

      {confirming && (
        <ConfirmSheet
          title="Start a Fresh Session?"
          body={
            needsApproval
              ? 'Your current session data will be stored safely in Settlement Details inside Settings. Nothing from the previous session will be lost. A new session will then start from ₹0. Your partner has to approve this before it happens.'
              : 'Your current session data will be stored safely in Settlement Details inside Settings. Nothing from the previous session will be lost. A new session will then start from ₹0.'
          }
          confirmLabel={needsApproval ? 'Send for approval' : 'Start Fresh Session'}
          tone="green"
          busy={busy}
          onConfirm={startFresh}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}

function Line({
  label,
  value,
  tone,
  strong,
}: {
  label: string;
  value: string;
  tone?: 'in' | 'out';
  strong?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        padding: '5px 0',
      }}
    >
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span
        className={tone === 'in' ? 'amount--in' : tone === 'out' ? 'amount--out' : undefined}
        style={{ fontWeight: strong ? 800 : 700, textAlign: 'right' }}
      >
        {value}
      </span>
    </div>
  );
}
