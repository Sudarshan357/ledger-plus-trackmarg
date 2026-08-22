import crypto from 'node:crypto';
import { config } from '../env.js';
import * as sessionsRepo from '../db/repositories/sessions.repository.js';
import type { DbClient } from '../db/prisma.js';

export interface SessionClaims {
  userId: string;
  groupId: string;
}

interface SessionPayload extends SessionClaims {
  aud: 'ledger';
  exp: number;
}

const THIRTY_DAYS_MS = 1000 * 60 * 60 * 24 * 30;

// Ledger+ signs with a DERIVED secret rather than the raw SESSION_SECRET it shares with the
// transport app. Both apps read the same env var, so without this a Ledger+ token would be a
// valid transport token and vice versa. Domain-separating the key (plus the `aud` claim
// checked on verify) keeps the two credential types from ever being interchangeable, which is
// the same trick the transport app's support console uses for its own separate token type.
const ledgerSecret = crypto
  .createHmac('sha256', config.sessionSecret)
  .update('ledger-plus/session/v1')
  .digest('hex');

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function createSessionToken(claims: SessionClaims): string {
  const payload: SessionPayload = { ...claims, aud: 'ledger', exp: Date.now() + THIRTY_DAYS_MS };
  const encoded = base64url(payload);
  const sig = crypto.createHmac('sha256', ledgerSecret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) return null;
    const [encoded, sig] = parts;
    const expected = crypto.createHmac('sha256', ledgerSecret).update(encoded).digest('base64url');
    // Length check first: timingSafeEqual throws on a length mismatch rather than returning
    // false, so an attacker could otherwise distinguish "wrong length" from "wrong signature".
    if (expected.length !== sig.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (payload.aud !== 'ledger') return null;
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Issues a signed token AND records its hash in public."Session". The token stays a
// self-contained HMAC credential (no DB hit needed to check signature or expiry), while the
// Session row is what makes revocation possible at all - used by logout and by Change PIN,
// which revokes every other device.
export async function issueSession(
  user: { id: string; groupId: string },
  client: DbClient,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<string> {
  const token = createSessionToken({ userId: user.id, groupId: user.groupId });
  await sessionsRepo.create(
    {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + THIRTY_DAYS_MS),
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
    },
    client,
  );
  return token;
}
