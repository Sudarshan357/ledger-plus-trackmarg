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

/// Where "back to TrackMarg" should go. Always answers - never null.
///
/// This started out conditional, appearing only for people who arrived from a TrackMarg link,
/// so the sign-in screen stayed exactly as designed for everyone else. That was wrong for the
/// case that matters most: the Android app loads its bundled UI from https://localhost/ with
/// no query string and no referrer, so none of the signals below can ever be present there.
/// The button was dead code in the app - and the app is precisely where it is needed, because
/// there is no browser chrome and someone stuck on the sign-in screen has no other way out.
///
/// So the hub is the floor, and the parameters only refine WHERE it goes, not WHETHER it shows.
export function trackmargReturnUrl(): string {
  let params: URLSearchParams | null = null;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    /* no location to read - fall through to the hub */
  }

  // 1. An explicit destination, validated. TrackMarg knows which page to return to; this app
  //    should not have to guess at a dashboard path that may not exist yet.
  const requested = params?.get('return');
  if (requested) {
    const safe = safeTarget(requested);
    if (safe) return safe;
    // A rejected return falls back to the hub rather than following it. The security property
    // that matters is never navigating somewhere untrusted, and that holds: a tampered link
    // sends the person to the real TrackMarg, not to whoever crafted it.
    return TRACKMARG_HUB_URL;
  }

  // 2. Nothing specific asked for - the hub is the general answer, and the only one available
  //    inside the packaged app.
  return TRACKMARG_HUB_URL;
}
