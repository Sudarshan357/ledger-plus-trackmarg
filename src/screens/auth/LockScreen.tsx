import { useState } from 'react';
import { ApiError } from '../../api/client';
import { useApp } from '../../state/AppContext';
import { ErrorText } from '../../components/ui';
import { PinDots, PinPad } from './PinPad';

/// Shown on every launch and whenever Lock App is used. No ledger figure is rendered behind
/// it and none is held in memory - the app state is cleared on lock and only refetched once
/// the server has confirmed the PIN.
export function LockScreen() {
  const { unlock, logout } = useApp();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (pin.length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await unlock(pin);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not unlock. Try again.');
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <h1 className="auth-logo">Ledger+</h1>
      <p className="auth-tag">Enter your PIN to unlock.</p>

      <PinDots filled={pin.length} />
      <ErrorText>{error}</ErrorText>

      <PinPad value={pin} onChange={setPin} onSubmit={submit} />

      <div style={{ height: 18 }} />
      <button className="btn" onClick={submit} disabled={busy || pin.length < 4}>
        {busy ? 'Unlocking…' : 'Unlock'}
      </button>

      <p style={{ textAlign: 'center', marginTop: 22, color: 'var(--text-muted)' }}>
        Not your account?{' '}
        <button className="link-button" onClick={() => void logout()}>
          Sign out
        </button>
      </p>
    </div>
  );
}
