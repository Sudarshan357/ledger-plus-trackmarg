/*
 * Getting back to TrackMarg.
 *
 * Ledger+ is one system reached from a TrackMarg link, so someone who arrives that way needs a
 * way back that is not the browser's Back button - on the Android build there is no browser
 * chrome at all, and after a sign-in redirect Back would land them mid-flow rather than where
 * they started.
 *
 * TrackMarg says where "back" goes, because only TrackMarg knows:
 *
 *   https://ledger.trackmarg.in/?return=https://trackmarg.in/dashboard
 *   https://ledger.trackmarg.in/?from=trackmarg          (no specific page - use the hub)
 *
 * A plain link with neither also works, via the referrer, so TrackMarg needs no change at all
 * for the button to appear.
 */

/// Where TrackMarg lives. Overridable per-build, same pattern as VITE_API_URL, so this can be
/// pointed at the real hub the moment it has a home with no code change.
export const TRACKMARG_HUB_URL = (import.meta.env.VITE_TRACKMARG_URL || 'https://trackmarg.in').replace(/\/$/, '');

/// The one host family we will ever send someone to, derived from the hub rather than written
/// down twice.
function hubHost(): string | null {
  try {
    return new URL(TRACKMARG_HUB_URL).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/// Is this somewhere we are willing to send a person?
///
/// This is the whole security surface of the feature, so it is a strict allowlist rather than a
/// blocklist. An unvalidated `?return=` is an open redirect, and an open redirect on a LOGIN
/// screen is the most valuable kind there is: the victim follows a link on the real
/// ledger.trackmarg.in, sees the real sign-in page, taps a button that says "Back to TrackMarg"
/// and lands on an attacker's copy - having already been taught that this exact flow is normal.
///
/// Rejected by construction, all via the host check rather than by pattern-matching the string:
///   //evil.com                  - protocol-relative; URL() resolves the host to evil.com
///   https://trackmarg.in.evil.com - does not end with "." + host
///   https://eviltrackmarg.in    - why the "." matters; a bare endsWith would pass this
///   javascript:...              - not http(s)
function isAllowed(url: URL): boolean {
  const host = hubHost();
  if (!host) return false;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  // http only where the hub itself is http - a LAN address in development, never in production.
  if (url.protocol === 'http:' && !TRACKMARG_HUB_URL.startsWith('http://')) return false;
  const target = url.hostname.toLowerCase();
  return target === host || target.endsWith(`.${host}`);
}

/// Resolves a candidate against the hub, so TrackMarg may pass either a full URL or just a
/// path ("/dashboard"). Returns null if it is not somewhere we will go.
function safeTarget(candidate: string): string | null {
  try {
    const url = new URL(candidate, `${TRACKMARG_HUB_URL}/`);
    return isAllowed(url) ? url.toString() : null;
  } catch {
    return null;
  }
}

/// Did this visit come from TrackMarg, and if so where should "back" go?
///
/// Null means show nothing. That matters: the sign-in screen is a signed-off design, and a
/// button that appeared for everyone would change it for everyone. It only appears for people
/// who actually arrived from TrackMarg and therefore have somewhere to go back to.
export function trackmargReturnUrl(): string | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return null;
  }

  // 1. An explicit destination, validated. TrackMarg knows which page to return to; this app
  //    should not have to guess at a dashboard path that may not exist yet.
  const requested = params.get('return');
  if (requested) {
    const safe = safeTarget(requested);
    // A rejected return is deliberately NOT quietly downgraded to the hub. If someone is
    // being pointed at evil.com, the honest response is to show no back button at all rather
    // than a working one that lends the tampered link an air of legitimacy.
    if (safe) return safe;
    return null;
  }

  // 2. Told it came from TrackMarg, but not where. The hub is the safe general answer.
  if (params.get('from') === 'trackmarg') return TRACKMARG_HUB_URL;

  // 3. An ordinary link from a TrackMarg page, needing nothing added at the other end. Absent
  //    under rel="noreferrer" or a strict referrer policy, which is why 1 and 2 exist.
  try {
    if (document.referrer) {
      const ref = new URL(document.referrer);
      // Ledger+ is itself a subdomain, so its own pages would otherwise qualify and every
      // internal navigation would look like an arrival from TrackMarg.
      if (isAllowed(ref) && ref.hostname.toLowerCase() !== window.location.hostname.toLowerCase()) {
        return TRACKMARG_HUB_URL;
      }
    }
  } catch {
    /* malformed referrer - treat as absent */
  }

  return null;
}
