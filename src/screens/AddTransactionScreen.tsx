import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useApp } from '../state/AppContext';
import { categoriesFor } from '../lib/categories';
import { todayIso } from '../lib/format';
import { Avatar, ErrorText, PageHead, Spinner } from '../components/ui';
import { ArrowDownIcon, ArrowUpIcon, CalendarIcon, CheckCircleIcon } from '../components/Icons';
import type { TxnType } from '../lib/types';

export function AddTransactionScreen() {
  const navigate = useNavigate();
  const { me, addTransaction } = useApp();

  const [type, setType] = useState<TxnType>('received');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(categoriesFor('received')[0]);
  const [date, setDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  // Defaults to whoever is signed in - recording for yourself is the common case, and the
  // uncommon one should take a deliberate tap.
  const [ownerId, setOwnerId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  // The amount is what you came here to type, so it takes focus - but with preventScroll.
  // The `autoFocus` attribute has no such option: the browser scrolls the field into view
  // above the on-screen keyboard, which pushed the header off the top of the page and made
  // the form look like it had opened halfway down.
  useEffect(() => {
    amountRef.current?.focus({ preventScroll: true });
  }, []);

  if (!me) return <Spinner />;

  // Empty state means "me": resolving it here rather than seeding state avoids an effect that
  // would fight the user if they switched partner before `me` had loaded.
  const effectiveOwnerId = ownerId || me.user.id;
  const ownerName =
    me.partners.find((p) => p.userId === effectiveOwnerId)?.name ?? me.user.name;

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
      await addTransaction({ type, category, amount: numericAmount, date, notes: notes.trim(), ownerId: effectiveOwnerId });
      navigate(-1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Please try again.');
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead title="Add Transaction" variant="close" onClose={() => navigate(-1)} />

      <div className="screen screen--nonav" style={{ paddingTop: 18 }}>
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

        <div className="field">
          <span className="field-label">Partner</span>
          {/* Whose entry this is. It can be either partner - one person often keeps the books
              for both - but who actually recorded it is taken from the session and stored
              alongside, so an entry filed for someone else always shows who filed it. */}
          <div className="pill-row">
            {me.partners.map((partner) => {
              const active = partner.userId === effectiveOwnerId;
              return (
                <button
                  key={partner.userId}
                  className={`owner-option${active ? ' owner-option--active' : ''}`}
                  aria-pressed={active}
                  onClick={() => setOwnerId(partner.userId)}
                >
                  <Avatar initials={partner.initials} small />
                  {partner.name}
                </button>
              );
            })}
          </div>
          {effectiveOwnerId !== me.user.id && (
            <p className="owner-note">
              This will be recorded as <strong>{ownerName}</strong>’s entry, noted as recorded
              by you.
            </p>
          )}
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
          <CheckCircleIcon size={20} /> {busy ? 'Saving…' : 'Save Transaction'}
        </button>
      </div>
    </>
  );
}
