import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ChevronLeftIcon, CloseIcon } from './Icons';

export function Spinner() {
  return <div className="spinner" role="status" aria-label="Loading" />;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {children}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="section-label">{children}</div>;
}

/// Sticky header for the screens that sit on top of a tab rather than inside it.
export function PageHead({
  title,
  variant = 'back',
  onClose,
}: {
  title: string;
  variant?: 'back' | 'close';
  onClose?: () => void;
}) {
  const navigate = useNavigate();
  const dismiss = () => (onClose ? onClose() : navigate(-1));
  return (
    <header className="page-head">
      <button onClick={dismiss} aria-label={variant === 'close' ? 'Close' : 'Back'}>
        {variant === 'close' ? <CloseIcon size={26} /> : <ChevronLeftIcon size={26} />}
      </button>
      <h1>{title}</h1>
      <span className="page-head-spacer" />
    </header>
  );
}

export function Avatar({ initials, small }: { initials: string; small?: boolean }) {
  return <div className={`avatar${small ? ' avatar--sm' : ''}`}>{initials}</div>;
}

/// Confirmation dialog. Destructive and irreversible actions in this app always route
/// through one of these, with the consequence spelled out rather than implied.
export function ConfirmSheet({
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary' | 'green';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const toneClass = tone === 'danger' ? 'btn btn--red' : tone === 'green' ? 'btn btn--green' : 'btn';
  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => {
        // Backdrop taps cancel; taps inside the sheet must not.
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="sheet">
        <h2 className="sheet-title">{title}</h2>
        <div className="sheet-body">{body}</div>
        <div className="btn-row">
          <button className="btn btn--ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button className={toneClass} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="error-text" role="alert">
      {children}
    </p>
  );
}
