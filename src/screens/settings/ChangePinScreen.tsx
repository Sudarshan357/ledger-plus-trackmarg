import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { ErrorText, PageHead } from '../../components/ui';
import { PinDots, PinPad } from '../auth/PinPad';

type Step = 'current' | 'next' | 'confirm';

const COPY: Record<Step, { title: string; hint: string }> = {
  current: { title: 'Current PIN', hint: 'Enter the PIN you use today.' },
  next: { title: 'New PIN', hint: '4 to 6 digits.' },
  confirm: { title: 'Confirm new PIN', hint: 'Enter the new PIN once more.' },
};

export function ChangePinScreen() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('current');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const value = step === 'current' ? current : step === 'next' ? next : confirm;
  const setValue = step === 'current' ? setCurrent : step === 'next' ? setNext : setConfirm;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/account/change-pin', {
        method: 'POST',
        body: { currentPin: current, newPin: next, confirmPin: confirm },
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change your PIN.');
      // Send them back to whichever step the server rejected, cleared.
      if (err instanceof ApiError && err.status === 401) {
        setCurrent('');
        setStep('current');
      } else {
        setNext('');
        setConfirm('');
        setStep('next');
      }
    } finally {
      setBusy(false);
    }
  };

  const advance = () => {
    setError(null);
    if (value.length < 4) {
      setError('A PIN is at least 4 digits');
      return;
    }
    if (step === 'current') return setStep('next');
    if (step === 'next') {
      if (next === current) {
        setNext('');
        return setError('Choose a PIN different from your current one');
      }
      return setStep('confirm');
    }
    if (confirm !== next) {
      setConfirm('');
      return setError('The two PINs do not match');
    }
    return void submit();
  };

  if (done) {
    return (
      <>
        <PageHead title="Change PIN" />
        <div className="screen screen--nonav" style={{ paddingTop: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>PIN updated</div>
          <p style={{ color: 'var(--text-muted)' }}>
            Your new PIN is active on this device. Any other device signed in to this account has
            been logged out.
          </p>
          <div style={{ height: 18 }} />
          <button className="btn" onClick={() => navigate('/settings', { replace: true })}>
            Done
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead title="Change PIN" />
      <div className="screen screen--nonav" style={{ paddingTop: 24 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 21, fontWeight: 800 }}>{COPY[step].title}</div>
          <p style={{ color: 'var(--text-muted)', margin: '4px 0 0' }}>{COPY[step].hint}</p>
        </div>

        <PinDots filled={value.length} />
        <ErrorText>{error}</ErrorText>

        <PinPad value={value} onChange={setValue} onSubmit={advance} />

        <div style={{ height: 18 }} />
        <button className="btn" onClick={advance} disabled={busy || value.length < 4}>
          {busy ? 'Saving…' : step === 'confirm' ? 'Save new PIN' : 'Continue'}
        </button>
      </div>
    </>
  );
}
