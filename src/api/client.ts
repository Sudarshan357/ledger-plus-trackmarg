const TOKEN_KEY = 'ledgerplus.token';

// Empty in both dev (Vite proxies /api to the API process) and production (Express serves the
// built app from the same origin). Set VITE_API_URL only when the frontend is hosted apart
// from its API - a phone pointed at a LAN address or a tunnel.
const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/// Identifies this browser tab for the lifetime of the page. Sent on every request so the
/// server can stamp its broadcasts with who caused them, which lets this tab ignore the echo
/// of its own change instead of reloading everything a second time.
export const CLIENT_ID = (() => {
  try {
    return crypto.randomUUID();
  } catch {
    // randomUUID needs a secure context; any unique-enough string will do here.
    return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
})();

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    // Private-mode Safari throws on localStorage access rather than returning null.
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable - the session simply will not survive a reload */
  }
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = getToken();
  let response: Response;

  try {
    response = await fetch(`${BASE}/api${path}`, {
      method: options.method || 'GET',
      headers: {
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'X-Ledger-Client': CLIENT_ID,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    // fetch only rejects on a network-level failure, which is a different problem from a
    // server that answered with an error - worth its own message on a phone in a workshop.
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const body = (payload ?? {}) as { message?: string; code?: string };
    throw new ApiError(response.status, body.message || 'Something went wrong.', body.code);
  }

  return payload as T;
}

// ── Support console ───────────────────────────────────────────────────────

const SUPPORT_KEY = 'ledgerplus.support';

// sessionStorage, not localStorage. A support token is cross-tenant access to every client's
// books; it should die with the tab rather than sit on disk until it expires.
export function getSupportToken(): string | null {
  try {
    return sessionStorage.getItem(SUPPORT_KEY);
  } catch {
    return null;
  }
}

export function setSupportToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(SUPPORT_KEY, token);
    else sessionStorage.removeItem(SUPPORT_KEY);
  } catch {
    /* storage unavailable */
  }
}

/// Same transport as `api`, but carrying the support token instead of a partner session.
export async function supportApi<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = getSupportToken();
  let response: Response;
  try {
    response = await fetch(`${BASE}/api/support${path}`, {
      method: options.method || 'GET',
      headers: {
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
  }

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const body = (payload ?? {}) as { message?: string; code?: string };
    throw new ApiError(response.status, body.message || 'Something went wrong.', body.code);
  }
  return payload as T;
}

// ── Impersonation hand-off ────────────────────────────────────────────────

const UNLOCK_GRANT_KEY = 'ledgerplus.unlockGrant';

/// Lets support drop straight into a client's account without being asked for that client's
/// PIN - which support does not know, and which would make the whole feature pointless.
///
/// Deliberately one-shot and per-tab: the next reload locks again like any other launch, so
/// "every launch asks for the PIN" still holds for real users. It grants no server-side
/// privilege either - the token issued by /support/impersonate is what actually authorises
/// anything, and this only skips a local screen.
export function grantUnlock(): void {
  try {
    sessionStorage.setItem(UNLOCK_GRANT_KEY, '1');
  } catch {
    /* storage unavailable */
  }
}

export function takeUnlockGrant(): boolean {
  try {
    const had = sessionStorage.getItem(UNLOCK_GRANT_KEY) === '1';
    sessionStorage.removeItem(UNLOCK_GRANT_KEY);
    return had;
  } catch {
    return false;
  }
}

/// The SSE URL. EventSource cannot set an Authorization header, which is why the API also
/// accepts the token as a query parameter on this one route.
export function eventsUrl(): string | null {
  const token = getToken();
  return token ? `${BASE}/api/events?token=${encodeURIComponent(token)}` : null;
}
