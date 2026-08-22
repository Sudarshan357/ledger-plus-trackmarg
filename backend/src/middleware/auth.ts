import type { Request, RequestHandler } from 'express';
import { verifySessionToken, hashToken } from '../services/tokens.js';
import * as sessionsRepo from '../db/repositories/sessions.repository.js';
import * as usersRepo from '../db/repositories/users.repository.js';
import { HttpError } from './errorHandler.js';

// Header OR ?token= query param. The query-param fallback exists for /api/events: the
// browser's native EventSource cannot set an Authorization header.
function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  const token = req.query.token;
  return typeof token === 'string' ? token : null;
}

/// Establishes WHO is calling and WHICH partnership they belong to. Every route below this
/// middleware reads `req.auth.groupId` for scoping and `req.auth.user.id` for ownership, and
/// neither is ever taken from the request body - that is the whole basis of the permission
/// model, so it is resolved here once, from the token, and nowhere else.
export function requireAuth(): RequestHandler {
  return async (req, _res, next) => {
    const token = getBearerToken(req);
    if (!token) return next(new HttpError(401, 'Sign in to continue'));

    // Signature and expiry first (cheap, no database), then the Session row - which is what
    // makes logout and PIN-change revocation actually take effect, since a signed token is
    // otherwise valid until it expires.
    const payload = verifySessionToken(token);
    if (!payload) return next(new HttpError(401, 'Sign in to continue'));

    const tokenHash = hashToken(token);

    // Issued in parallel, and the membership rides along inside the user query. These used to
    // be three sequential round trips to a database in another region, which put roughly a
    // second of pure latency in front of every single request in the app. Running them
    // together is safe: neither result leaks anything on its own, and both are needed before
    // the request can proceed either way.
    const [session, user] = await Promise.all([
      sessionsRepo.findActiveByTokenHash(tokenHash),
      usersRepo.findActiveByIdAndGroup(payload.userId, payload.groupId),
    ]);

    if (!session) return next(new HttpError(401, 'Sign in to continue'));
    if (!user) return next(new HttpError(401, 'Sign in to continue'));

    // A valid Trackmarg account is not by itself a Ledger+ partner. Without this check a
    // transport user could reach the ledger API for their group.
    const member = user.ledgerMember;
    if (!member || member.groupId !== user.groupId) {
      return next(new HttpError(403, 'This account is not part of a Ledger+ partnership'));
    }

    req.auth = {
      user,
      group: user.group,
      member,
      groupId: user.groupId,
      groupCode: user.group.code,
      tokenHash,
    };
    next();
  };
}

/// Refuses everything for a frozen partnership.
///
/// Mounted as its own step rather than folded into requireAuth() because two routes have to
/// stay reachable while frozen: `/events`, which is the channel the unfreeze arrives on, and
/// `/account`, so the device can still unlock and sign out. Blocking those too would mean a
/// frozen client had no way to learn it had been released short of the user reloading, and
/// support would appear not to have worked.
export function blockIfFrozen(): RequestHandler {
  return (req, _res, next) => {
    if (req.auth?.group.frozen) {
      return next(
        new HttpError(
          423,
          'Your account has been frozen by our support console',
          'ACCOUNT_FROZEN',
        ),
      );
    }
    next();
  };
}

/// Narrowing helper so route handlers get a non-optional `auth` without repeating the check.
/// requireAuth() has already run by the time any of them execute; this converts that
/// guarantee into something the type system agrees with.
export function auth(req: Request): NonNullable<Request['auth']> {
  if (!req.auth) throw new HttpError(401, 'Sign in to continue');
  return req.auth;
}
