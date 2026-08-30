import { useApp } from '../state/AppContext';

/// "2 minutes ago", "yesterday" - enough to judge whether the figures are worth trusting.
function ago(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 90) return 'moments ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/// Shown whenever the figures on screen came from the device rather than the server.
///
/// Not dismissible, and deliberately states the time rather than just the fact. "Offline" on
/// its own invites the reading that the numbers are merely a little behind; in a two-partner
/// ledger the other person may have entered half a day of work since, and the difference
/// between "synced moments ago" and "synced yesterday" is the difference between figures you
/// can act on and figures you cannot.
export function OfflineBanner() {
  const { offline, lastSyncedAt } = useApp();
  if (!offline) return null;

  return (
    <div className="offline-bar" role="status">
      <span className="offline-dot" aria-hidden="true" />
      <span className="offline-text">
        Offline — showing your ledger as it was{lastSyncedAt ? ` ${ago(lastSyncedAt)}` : ''}. You
        can look, but not save.
      </span>
    </div>
  );
}
