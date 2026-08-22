import { useState } from 'react';
import { ApiError } from '../../api/client';
import { useApp } from '../../state/AppContext';
import { ErrorText } from '../../components/ui';
import { PinDots, PinPad } from './PinPad';

type Mode = 'choose' | 'create' | 'join' | 'login';
type Step = 'details' | 'pin' | 'confirm';

/// First-run and returning-user entry. One screen handles all four paths (start a
/// partnership, join one with a code, sign in again) because they differ only in which
/// fields are collected before the same PIN step.
export function WelcomeScreen() {
  const { register, login } = useApp();
  const [mode, setMode] = useState<Mode>('choose');
  const [step, setStep] = useState<Step>('details');

  const [name, setName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [phone, setPhone] = useState('');
  const [groupCode, setGroupCode] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = (next: Mode) => {
    setMode(next);
    setStep('details');
    setError(null);
    setPin('');
    setConfirmPin('');
  };

  const detailsValid = () => {
    if (mode === 'login') return /^[0-9]{10,15}$/.test(phone) && groupCode.trim().length >= 4;
    if (!name.trim()) return false;
    if (!/^[0-9]{10,15}$/.test(phone)) return false;
    if (mode === 'join') return groupCode.trim().length >= 4;
    return true;
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') {
        await login({ groupCode, phone, pin });
      } else {
        await register({
          mode: mode === 'create' ? 'create' : 'join',
          name: name.trim(),
          phone,
          pin,
          confirmPin,
          groupCode,
          businessName: businessName.trim(),
        });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      // Send them back to the PIN step with it cleared, rather than stranding them on a
      // confirm screen whose value is already wrong.
      setPin('');
      setConfirmPin('');
      setStep('pin');
    } finally {
      setBusy(false);
    }
  };

  // ── Choose path ──────────────────────────────────────────────────────────
  if (mode === 'choose') {
    return (
      <div className="auth">
        <h1 className="auth-logo">Ledger+</h1>
        <p className="auth-tag">Partnership accounting, powered by Trackmarg.</p>

        <button className="btn" onClick={() => reset('create')}>
          Start a new partnership
        </button>
        <div style={{ height: 10 }} />
        <button className="btn btn--ghost" onClick={() => reset('join')}>
          Join with a group code
        </button>

        <p style={{ textAlign: 'center', marginTop: 28, color: 'var(--text-muted)' }}>
          Already registered?{' '}
          <button className="link-button" onClick={() => reset('login')}>
            Sign in
          </button>
        </p>
      </div>
    );
  }

  // ── PIN steps ────────────────────────────────────────────────────────────
  if (step === 'pin' || step === 'confirm') {
    const isConfirm = step === 'confirm';
    const value = isConfirm ? confirmPin : pin;
    const setValue = isConfirm ? setConfirmPin : setPin;
    const title = mode === 'login' ? 'Enter your PIN' : isConfirm ? 'Confirm your PIN' : 'Create a PIN';

    const advance = () => {
      setError(null);
      if (mode === 'login') {
        if (pin.length < 4) return setError('Your PIN is at least 4 digits');
        return void submit();
      }
      if (!isConfirm) {
        if (pin.length < 4) return setError('Choose a PIN of 4 to 6 digits');
        return setStep('confirm');
      }
      if (confirmPin !== pin) {
        setConfirmPin('');
        return setError('The two PINs do not match');
      }
      return void submit();
    };

    return (
      <div className="auth">
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>{title}</h1>
        <p className="auth-tag" style={{ marginBottom: 0 }}>
          {mode === 'login'
            ? 'Enter the PIN for this account.'
            : '4 to 6 digits. You will use it every time you open Ledger+.'}
        </p>

        <PinDots filled={value.length} />
        <ErrorText>{error}</ErrorText>

        <PinPad value={value} onChange={setValue} onSubmit={advance} />

        <div style={{ height: 18 }} />
        <button className="btn" onClick={advance} disabled={busy || value.length < 4}>
          {busy ? 'Please wait…' : isConfirm || mode === 'login' ? 'Continue' : 'Next'}
        </button>
        <div style={{ height: 10 }} />
        <button
          className="btn btn--ghost"
          onClick={() => {
            setError(null);
            if (isConfirm) {
              setConfirmPin('');
              setStep('pin');
            } else {
              setPin('');
              setStep('details');
            }
          }}
          disabled={busy}
        >
          Back
        </button>
      </div>
    );
  }

  // ── Details step ─────────────────────────────────────────────────────────
  const heading =
    mode === 'create' ? 'Start a partnership' : mode === 'join' ? 'Join a partnership' : 'Sign in';

  return (
    <div className="auth">
      <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 4px' }}>{heading}</h1>
      <p className="auth-tag">
        {mode === 'create'
          ? 'You will get a Trackmarg group code to share with your partner.'
          : mode === 'join'
            ? 'Enter the group code your partner shared with you.'
            : 'Sign in with your group code and phone number.'}
      </p>

      <ErrorText>{error}</ErrorText>

      {mode !== 'login' && (
        <div className="field">
          <label className="field-label" htmlFor="name">
            Full name
          </label>
          <input
            id="name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            placeholder="Sahadev Pol"
          />
        </div>
      )}

      {mode === 'create' && (
        <div className="field">
          <label className="field-label" htmlFor="business">
            Business name (optional)
          </label>
          <input
            id="business"
            className="input"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="S S Hydraulics & Fabrication"
          />
        </div>
      )}

      {mode !== 'create' && (
        <div className="field">
          <label className="field-label" htmlFor="code">
            Group code
          </label>
          <input
            id="code"
            className="input"
            value={groupCode}
            onChange={(e) => setGroupCode(e.target.value.toUpperCase())}
            placeholder="TM-4821"
            autoCapitalize="characters"
            spellCheck={false}
          />
        </div>
      )}

      <div className="field">
        <label className="field-label" htmlFor="phone">
          Phone number
        </label>
        <input
          id="phone"
          className="input"
          value={phone}
          // inputMode rather than type="number": a numeric keypad without the spinner
          // controls and scroll-to-change behaviour a number input brings.
          inputMode="numeric"
          onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, ''))}
          autoComplete="tel"
          placeholder="9876543210"
        />
      </div>

      <button className="btn" onClick={() => setStep('pin')} disabled={!detailsValid()}>
        Continue
      </button>
      <div style={{ height: 10 }} />
      <button className="btn btn--ghost" onClick={() => reset('choose')}>
        Back
      </button>
    </div>
  );
}
