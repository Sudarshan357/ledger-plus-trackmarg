import { useEffect } from 'react';

/// Numeric keypad for entering a PIN. A real keypad rather than a text input: it keeps the
/// digits big enough to hit with a thumb, never raises a keyboard that covers half the
/// screen, and cannot accidentally receive non-numeric input.
export function PinPad({
  value,
  onChange,
  maxLength = 6,
  onSubmit,
}: {
  value: string;
  onChange: (next: string) => void;
  maxLength?: number;
  onSubmit?: () => void;
}) {
  const press = (digit: string) => {
    if (value.length >= maxLength) return;
    onChange(value + digit);
  };

  // Physical keyboards should work too - this app runs in a browser, and someone testing on
  // a laptop should not have to click twelve buttons.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (/^[0-9]$/.test(event.key)) {
        if (value.length < maxLength) onChange(value + event.key);
      } else if (event.key === 'Backspace') {
        onChange(value.slice(0, -1));
      } else if (event.key === 'Enter' && onSubmit) {
        onSubmit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [value, maxLength, onChange, onSubmit]);

  return (
    <div className="keypad">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
        <button key={digit} type="button" className="key" onClick={() => press(digit)}>
          {digit}
        </button>
      ))}
      <span className="key key--blank" />
      <button type="button" className="key" onClick={() => press('0')}>
        0
      </button>
      <button
        type="button"
        className="key"
        onClick={() => onChange(value.slice(0, -1))}
        aria-label="Delete"
      >
        ⌫
      </button>
    </div>
  );
}

/// Shows as many slots as there are digits, never fewer than the 4-digit minimum.
///
/// A fixed row of six was wrong: a PIN can be 4 to 6 digits and the screen has no way to know
/// which, because the PIN is only ever stored hashed. So someone with a 4-digit PIN typed all
/// of it and still saw two empty circles, which reads as "you are not finished yet". Growing
/// the row instead means a 4-digit PIN ends on exactly four filled dots, while a longer one
/// still has somewhere to go.
export function PinDots({ filled, min = 4, max = 6 }: { filled: number; min?: number; max?: number }) {
  const slots = Math.min(max, Math.max(min, filled));
  return (
    <div className="pin-dots" aria-hidden="true">
      {Array.from({ length: slots }, (_, i) => (
        <span key={i} className={`pin-dot${i < filled ? ' pin-dot--filled' : ''}`} />
      ))}
    </div>
  );
}
