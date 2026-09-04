import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useApp } from '../state/AppContext';
import { categoriesFor } from '../lib/categories';
import { todayIso } from '../lib/format';
import { Avatar, ConfirmSheet, ErrorText, PageHead, Spinner } from '../components/ui';
import { ArrowDownIcon, ArrowUpIcon, CalendarIcon, CheckCircleIcon } from '../components/Icons';
import type { TxnType } from '../lib/types';

/// Mirrors backend/src/routes/transactions.routes.ts - purely informational here. The server
/// decides for real; this only sets the reader's expectations before they tap Save.
const EDIT_WINDOW_MS = 10 * 60 * 1000;

export function AddTransactionScreen() {
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const isEdit = Boolean(id);
  const { me, transactions, addTransaction, updateTransaction } = useApp();

  // Only the current session's own list is searched - the same scope the Ledger screen's
  // delete button already restricts itself to, since a settled session is history.
  const existing = isEdit ? transactions.find((t) => t.id === id) : undefined;

  const [type, setType] = useState<TxnType>('received');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(categoriesFor('received')[0]);
  const [date, setDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentForApproval, setSentForApproval] = useState(false);
  // Switching who an entry is for is deliberately not a plain tap - confirming first is the
  // point, since it is easy to fire off a pill-row tap without meaning to move an entry onto
  // someone else's side of the books.
  const [confirmPartnerSwitch, setConfirmPartnerSwitch] = useState(false);
  // Add mode has nothing to wait for. Edit mode fills the fields from `existing` once it is
  // available rather than at mount, so a page refresh landing straight on this URL (the
  // transaction list not loaded yet) still ends up prefilled once it arrives.
  const [seeded, setSeeded] = useState(!isEdit);
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    amountRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!isEdit || seeded || !existing) return;
    setType(existing.type);
    setAmount(String(existing.amount));
    setCategory(existing.category);
    setDate(existing.date);
    setNotes(existing.notes);
    setOwnerId(existing.ownerId);
    setSeeded(true);
  }, [isEdit, seeded, existing]);

  if (!me) return <Spinner />;

  if (isEdit && !existing) {
    return (
      <>
        <PageHead title="Edit Transaction" variant="close" onClose={() => navigate(-1)} />
        <div className="screen screen--nonav">
          <p className="screen-subtitle">
            This entry could not be found here - it may belong to a past session, or have moved
            to Deleted Records.
          </p>
        </div>
      </>
    );
  }

  // Empty state means "me": resolving it here rather than seeding state avoids an effect that
  // would fight the user if they switched partner before `me` had loaded.
  const effectiveOwnerId = ownerId || me.user.id;
  const ownerName =
    me.partners.find((p) => p.userId === effectiveOwnerId)?.name ?? me.user.name;
  // Who "Change partner" would switch to - the first partner who is not whoever is currently
  // selected. With the usual two partners that is simply the other one.
  const switchTarget = me.partners.find((p) => p.userId !== effectiveOwnerId);

  // Whether saving now would need the other partner's agreement - informational only, the
  // server enforces the real rule. A solo partnership has nobody to ask, so edits there always
  // apply immediately regardless of age.
  const soloPartnership = me.partners.length < 2;
  const msSinceCreated = existing ? Date.now() - new Date(existing.createdAt).getTime() : 0;
  const minutesLeft = Math.max(0, Math.ceil((EDIT_WINDOW_MS - msSinceCreated) / 60000));
  const willNeedApproval = isEdit && !soloPartnership && msSinceCreated >= EDIT_WINDOW_MS;
  const otherPartnerName = me.partners.find((p) => p.userId !== me.user.id)?.name ?? 'your partner';

  const chooseType = (next: TxnType) => {
    setType(next);
    // Received and expense have different category vocabularies, so the current pick is
    // almost never valid for the other type - reset to that type's first option.
    setCategory(categoriesFor(next)[0]);
  };

  const numericAmount = Number(amount);
  const canSave = amount !== '' && Number.isFinite(numericAmount) && numericAmount > 0 && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      if (isEdit && existing) {
        const { applied } = await updateTransaction(existing.id, {
          type,
          category,
          amount: numericAmount,
          date,
          notes: notes.trim(),
        });
        if (applied) {
          navigate(-1);
        } else {
          // Nothing on the entry has changed yet - it shows as "Pending approval" back on the
          // Ledger screen, and as a request to decide on the other partner's Home screen.
          setSentForApproval(true);
          setBusy(false);
        }
      } else {
        await addTransaction({ type, category, amount: numericAmount, date, notes: notes.trim(), ownerId: effectiveOwnerId });
        navigate(-1);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Please try again.');
      setBusy(false);
    }
  };

  if (sentForApproval) {
    return (
      <>
        <PageHead title="Edit Transaction" variant="close" onClose={() => navigate(-1)} />
        <div className="screen screen--nonav" style={{ paddingTop: 18 }}>
          <div className="edit-sent">
            <div className="edit-sent-title">Change sent for approval</div>
            <p className="edit-sent-body">
              This entry is more than 10 minutes old, so {otherPartnerName} needs to agree before
              it changes. It still shows its original figures until then.
            </p>
          </div>
        </div>
        <div className="sticky-footer">
          <button className="btn" onClick={() => navigate(-1)}>
            Back to Ledger
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead
        title={isEdit ? 'Edit Transaction' : 'Add Transaction'}
        variant="close"
        onClose={() => navigate(-1)}
      />

      <div className={`screen screen--nonav ${type === 'received' ? 'screen--tint-in' : 'screen--tint-out'}`} style={{ paddingTop: 18 }}>
        <div className="type-toggle">
          <button
            className="type-in"
            aria-pressed={type === 'received'}
            onClick={() => chooseType('received')}
          >
            <ArrowDownIcon size={19} /> Received
          </button>
          <button
            className="type-out"
            aria-pressed={type === 'expense'}
            onClick={() => chooseType('expense')}
          >
            <ArrowUpIcon size={19} /> Expense
          </button>
        </div>

        <ErrorText>{error}</ErrorText>

        {isEdit && (
          <p className={`edit-window-note${willNeedApproval ? ' edit-window-note--warn' : ''}`}>
            {willNeedApproval
              ? `This entry is more than 10 minutes old. Saving will ask ${otherPartnerName} to approve the change.`
              : soloPartnership
                ? 'Changes save immediately.'
                : `You can still edit this freely for about ${minutesLeft} more ${minutesLeft === 1 ? 'minute' : 'minutes'}.`}
          </p>
        )}

        <div className="field">
          <label className="field-label" htmlFor="amount">
            Amount
          </label>
          <div className="amount-input">
            <span>₹</span>
            <input
              id="amount"
              ref={amountRef}
              // decimal, not numeric: paise need a decimal point on the phone keypad.
              inputMode="decimal"
              value={amount}
              placeholder="0"
              onChange={(e) => {
                const next = e.target.value.replace(/[^0-9.]/g, '');
                // At most one decimal point and two paise digits.
                if (/^\d*\.?\d{0,2}$/.test(next)) setAmount(next);
              }}
            />
          </div>
        </div>

        {isEdit ? (
          <div className="field">
            <span className="field-label">Partner</span>
            <p className="owner-note" style={{ marginTop: 0 }}>
              This entry is recorded as <strong>{ownerName}</strong>’s. Who it is recorded for
              cannot be changed after saving.
            </p>
          </div>
        ) : (
          <div className="field">
            <span className="field-label">Partner</span>
            {/* Whose entry this is. It can be either partner - one person often keeps the books
                for both - but switching is behind a confirmation rather than a plain tap, since
                a stray tap here quietly moves an entry onto someone else's side of the books. */}
            <div className="owner-display">
              <span className="owner-option owner-option--active">
                <Avatar initials={me.partners.find((p) => p.userId === effectiveOwnerId)?.initials ?? '?'} small />
                {ownerName}
              </span>
              {me.partners.length > 1 && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setConfirmPartnerSwitch(true)}
                >
                  Change partner
                </button>
              )}
            </div>
            {effectiveOwnerId !== me.user.id && (
              <p className="owner-note">
                This will be recorded as <strong>{ownerName}</strong>’s entry, noted as recorded
                by you.
              </p>
            )}
          </div>
        )}

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
          <label className="field-label" htmlFor="date">
            Date
          </label>
          <div className="amount-input" style={{ padding: '12px 14px', gap: 12 }}>
            <CalendarIcon size={21} style={{ color: 'var(--text-muted)', flex: '0 0 auto' }} />
            <input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{ fontSize: 17, fontWeight: 600 }}
            />
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="notes">
            Notes (optional)
          </label>
          <textarea
            id="notes"
            className="input"
            value={notes}
            maxLength={500}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Job details, invoice #, etc."
          />
        </div>
      </div>

      <div className="sticky-footer">
        <button className="btn" onClick={save} disabled={!canSave}>
          <CheckCircleIcon size={20} />{' '}
          {busy ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Transaction'}
        </button>
      </div>

      {confirmPartnerSwitch && switchTarget && (
        <ConfirmSheet
          title="Change partner?"
          body={
            <>
              This entry will be recorded for <strong>{switchTarget.name}</strong> instead of{' '}
              <strong>{ownerName}</strong>.
            </>
          }
          confirmLabel="Continue"
          tone="primary"
          onConfirm={() => {
            setOwnerId(switchTarget.userId);
            setConfirmPartnerSwitch(false);
          }}
          onCancel={() => setConfirmPartnerSwitch(false)}
        />
      )}
    </>
  );
}
