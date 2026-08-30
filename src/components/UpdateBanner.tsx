import { useState } from 'react';
import { CloudUploadIcon } from './Icons';
import type { UpdateState } from '../lib/version';

/// The one line of status under the button, for the Android flow.
///
/// Returns null on the web, where applying an update is a reload: the page is replaced before
/// any progress could be shown, so inventing phases there would be theatre.
function statusLine(update: UpdateState): string | null {
  if (!update.native) return null;
  switch (update.phase) {
    case 'permission-needed':
      return 'Android needs permission to install apps from Ledger+ first.';
    case 'downloading': {
      const pct = update.progress?.percent ?? -1;
      // -1 means the server sent no Content-Length, so a percentage would be a guess.
      return pct >= 0 ? `Downloading… ${Math.round(pct)}%` : 'Downloading…';
    }
    case 'ready-to-install':
      return 'Downloaded. Confirm the install when Android asks.';
    case 'error':
      return update.error ?? 'The update could not be installed.';
    default:
      return null;
  }
}

function actionLabel(update: UpdateState): string {
  if (update.phase === 'permission-needed') return 'Allow';
  if (update.phase === 'downloading') return 'Downloading…';
  if (update.phase === 'ready-to-install') return 'Install';
  if (update.phase === 'error') return 'Try again';
  return 'Update';
}

/// Two shapes, because an optional update and a mandatory one are different situations.
///
/// Optional is a slim, dismissible bar: the old build still works against the new server, so
/// interrupting someone mid-entry to tell them about it would be rude. Mandatory is a full
/// stop, because the running build can no longer talk to this server correctly and letting it
/// keep trying would produce confusing failures rather than an honest explanation.
///
/// Neither ever acts on its own. On the web applying means a reload, which throws away
/// whatever is half-typed in the Add Transaction form; on Android it means downloading a few
/// megabytes on someone's mobile data. Both only ever happen on a tap.
export function UpdateBanner({ update }: { update: UpdateState }) {
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const { release } = update;
  const label = release ? `v${release.versionName}` : null;
  const notes = release?.releaseNotes ?? [];
  const status = statusLine(update);
  const busy = update.phase === 'downloading';
  const onAction = update.phase === 'permission-needed' ? update.openPermissionSettings : update.apply;

  if (update.required) {
    return (
      <div className="update-block">
        <div className="update-block-inner">
          <div className="update-mark">
            <CloudUploadIcon size={44} />
          </div>
          <h1 className="update-title">
            {label ? `Ledger+ ${label} is ready` : 'A new version of Ledger+ is ready'}
          </h1>
          <p className="update-body">
            This version can no longer work with the server. Update to carry on — your ledger is
            stored on the server and is completely unaffected.
          </p>
          {notes.length > 0 && (
            <ul className="update-notes update-notes--block">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
          <button className="btn" onClick={onAction} disabled={busy} style={{ marginTop: 26 }}>
            {update.phase === 'error' ? 'Try again' : actionLabel(update)}
          </button>
          {status && <p className="update-status">{status}</p>}
        </div>
      </div>
    );
  }

  if (!update.available || dismissed) return null;

  return (
    <div className="update-bar-wrap">
      <div className="update-bar">
        <CloudUploadIcon size={19} />
        <span className="update-bar-text">
          Update available{label ? ` · ${label}` : ''}
        </span>
        {/* What changed is worth a tap, not a permanent block of text above the balances. */}
        {notes.length > 0 && (
          <button
            className="update-bar-later"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
          >
            {expanded ? 'Hide' : "What's new"}
          </button>
        )}
        <button className="update-bar-action" onClick={onAction} disabled={busy}>
          {actionLabel(update)}
        </button>
        {/* Dismissing mid-download would leave it running with nothing to show for it. */}
        {!busy && (
          <button
            className="update-bar-later"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss until next time"
          >
            Later
          </button>
        )}
      </div>

      {status && <p className="update-status">{status}</p>}

      {expanded && notes.length > 0 && (
        <ul className="update-notes">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
