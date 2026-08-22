import crypto from 'node:crypto';
import { config } from '../env.js';

interface SupportPayload {
  support: 'ledger';
  exp: number;
}

// Short-lived on purpose. This token is cross-tenant god mode; a 30-day one left in a browser
// somewhere is a standing liability in a way a partner's own session is not.
const FOUR_HOURS_MS = 1000 * 60 * 60 * 4;

// Derived from SESSION_SECRET with its own label, and signed over its own prefix.
//
// Both matter. Ledger+ shares SESSION_SECRET with the Trackmarg transport app, and that app
// has its own support console signing tokens as `support:${encoded}` with the raw secret. Were
// this to do the same, a transport support token would unlock the Ledger+ console and vice
// versa - one console's password would quietly grant access to the other's clients.
const supportSecret = crypto
  .createHmac('sha256', config.sessionSecret)
  .update('ledger-plus/support/v1')
  .digest('hex');

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function createSupportToken(): string {
  const payload: SupportPayload = { support: 'ledger', exp: Date.now() + FOUR_HOURS_MS };
  const encoded = base64url(payload);
  const sig = crypto.createHmac('sha256', supportSecret).update(`ledger-support:${encoded}`).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySupportToken(token: string): boolean {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) return false;
    const [encoded, sig] = parts;
    const expected = crypto
      .createHmac('sha256', supportSecret)
      .update(`ledger-support:${encoded}`)
      .digest('base64url');
    if (expected.length !== sig.length) return false;
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return false;
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SupportPayload;
    return payload.support === 'ledger' && payload.exp > Date.now();
  } catch {
    return false;
  }
}

/// Constant-time password check. A plain `===` leaks how much of the password matched through
/// response timing, which is exactly the wrong property for the one credential guarding every
/// client's books.
export function matchesSupportPassword(provided: string): boolean {
  const expected = config.supportPassword;
  if (!expected) return false;
  const a = Buffer.from(provided.padEnd(expected.length, '\0'));
  const b = Buffer.from(expected.padEnd(provided.length, '\0'));
  return provided.length === expected.length && crypto.timingSafeEqual(a, b);
}
