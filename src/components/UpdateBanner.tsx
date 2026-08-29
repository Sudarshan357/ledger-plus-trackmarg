import { useState } from 'react';
import { CloudUploadIcon } from './Icons';
import type { UpdateState } from '../lib/version';

/// Two shapes, because an optional update and a mandatory one are different situations.
///
/// Optional is a slim, dismissible bar: the old build still works against the new server, so
/// interrupting someone mid-entry to tell them about it would be rude. Mandatory is a full
/// stop, because the running build can no longer talk to this server correctly and letting it
/// keep trying would produce confusing failures rather than an honest explanation.
///
/// Neither ever reloads on its own. A reload throws away whatever is half-typed in the Add
/// Transaction form, so it only ever happens on a tap.
export function UpdateBanner({ update }: { update: UpdateState }) {
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const { release } = update;
  const label = release ? `v${release.versionName}` : null;
  const notes = release?.releaseNotes ?? [];

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
          <button className="btn" onClick={update.apply} style={{ marginTop: 26 }}>
            Update now
          </button>
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
        <button className="update-bar-action" onClick={update.apply}>
          Update
        </button>
        <button
          className="update-bar-later"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss until next time"
        >
          Later
        </button>
      </div>

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
