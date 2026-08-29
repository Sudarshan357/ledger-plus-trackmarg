import type { Request } from 'express';
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { transaction, prisma } from '../db/prisma.js';
import * as usersRepo from '../db/repositories/users.repository.js';
import * as sessionsRepo from '../db/repositories/sessions.repository.js';
import * as auditLogsRepo from '../db/repositories/auditLogs.repository.js';
import { createSupportToken, matchesSupportPassword, verifySupportToken } from '../services/supportTokens.js';
import { issueSession } from '../services/tokens.js';
import { hashPin, isValidPin } from '../services/passwords.js';
import { formatGroupCode, initialsOf, normalizeGroupCode } from '../services/codes.js';
import { computeSettlement, toRupees } from '../services/money.js';
import { supportLoginLimiter } from '../middleware/rateLimit.js';
import { HttpError } from '../middleware/errorHandler.js';
import { broadcast } from '../services/sse.js';
import { config } from '../env.js';

export const supportRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// THE ONE PLACE IN THIS CODEBASE THAT CROSSES THE TENANT BOUNDARY.
//
// Every other query is scoped by groupId on purpose; these are not, because the whole job of
// a support console is to look across clients. That makes this the most dangerous file here,
// so it is deliberately hemmed in:
//
//   * Off unless LEDGER_SUPPORT_PASSWORD is set. Not "hidden" - every route below returns a
//     genuine 404, so an unconfigured deployment has no support surface to find at all.
//   * Its own short-lived token, signed with its own derived key (services/supportTokens.ts).
//   * Login is rate limited to 5 failures per 15 minutes and compared in constant time.
//   * Every mutation writes a support.* row to the affected group's audit log. A client can
//     always see that support touched their books, and what it did.
// ─────────────────────────────────────────────────────────────────────────────

/// Returns 404 rather than 401/403 when the console is switched off: an operator who never
/// configured it should not be told there is a door here.
function requireEnabled(): void {
  if (!config.supportPassword) throw new HttpError(404, 'Route not found');
}

function requireSupport(req: Request): void {
  requireEnabled();
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !verifySupportToken(token)) {
    throw new HttpError(401, 'Support session expired - sign in again');
  }
}

/// Support actions are recorded against the client's own group, using a reserved actor id so
/// they can never be mistaken for something a partner did.
async function logSupport(
  groupId: string,
  action: string,
  entityId: string | null,
  details: Prisma.InputJsonValue,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  await auditLogsRepo.create(
    { groupId, userId: 'support', userName: 'Support console', action, entityId, details },
    client,
  );
}

// ── LOGIN ───────────────────────────────────────────────────────────────────
supportRouter.post('/login', supportLoginLimiter, (req, res, next) => {
  try {
    requireEnabled();
    if (!matchesSupportPassword(String(req.body?.password || ''))) {
      throw new HttpError(401, 'Incorrect password');
    }
    res.json({ token: createSupportToken() });
  } catch (err) {
    next(err);
  }
});

// ── LIST EVERY PARTNERSHIP ──────────────────────────────────────────────────
supportRouter.get('/partnerships', async (req, res, next) => {
  try {
    requireSupport(req);

    // Only groups that are actually Ledger+ partnerships. The database is shared with the
    // Trackmarg transport app, and its groups are none of this console's business.
    const members = await prisma.ledgerMember.findMany({
      include: { user: true, group: true },
      orderBy: { joinedAt: 'asc' },
    });

    const byGroup = new Map<string, typeof members>();
    for (const m of members) {
      if (!byGroup.has(m.groupId)) byGroup.set(m.groupId, []);
      byGroup.get(m.groupId)!.push(m);
    }

    const partnerships = await Promise.all(
      [...byGroup.entries()].map(async ([groupId, groupMembers]) => {
        const group = groupMembers[0].group;
        const [session, txnCount, settlementCount] = await Promise.all([
          prisma.ledgerSession.findFirst({ where: { groupId, status: 'active' } }),
          prisma.ledgerTransaction.count({ where: { groupId, deletedAt: null } }),
          prisma.ledgerSettlement.count({ where: { groupId } }),
        ]);

        const rows = session
          ? await prisma.ledgerTransaction.findMany({
              where: { groupId, sessionId: session.id, deletedAt: null },
            })
          : [];
        const computation = computeSettlement(
          groupMembers.map((m) => ({ userId: m.userId, name: m.user.name })),
          rows,
        );

        return {
          groupId,
          name: group.name,
          code: group.code,
          displayCode: formatGroupCode(group.code),
          frozen: group.frozen,
          createdAt: group.createdAt.toISOString(),
          sessionSeq: session?.seq ?? null,
          transactionCount: txnCount,
          settlementCount,
          totalProfit: toRupees(computation.totalProfit),
          partners: groupMembers.map((m) => ({
            userId: m.userId,
            name: m.user.name,
            phone: m.user.phone,
            initials: initialsOf(m.user.name),
            partnerCode: m.user.userCode ?? '',
            role: m.role,
            active: m.user.active,
            joinedAt: m.joinedAt.toISOString(),
          })),
        };
      }),
    );

    partnerships.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ partnerships });
  } catch (err) {
    next(err);
  }
});

// ── OPEN A CLIENT'S ACCOUNT ─────────────────────────────────────────────────
supportRouter.post('/impersonate', async (req, res, next) => {
  try {
    requireSupport(req);
    const userId = String(req.body?.userId || '');

    const member = await prisma.ledgerMember.findUnique({ where: { userId }, include: { user: true, group: true } });
    if (!member) throw new HttpError(404, 'No Ledger+ partner with that id');
    if (!member.user.active) throw new HttpError(409, 'That account is deactivated');

    // A REAL session token, identical to one from a normal login. Nothing downstream needs to
    // special-case support being "in" as this partner - which is the point, because a support
    // path that behaved differently from the real app would not reproduce the client's bug.
    const token = await issueSession({ id: member.userId, groupId: member.groupId }, prisma, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    await logSupport(member.groupId, 'support.impersonate', member.userId, {
      partnerName: member.user.name,
      groupCode: member.group.code,
    });

    res.json({
      token,
      partnerName: member.user.name,
      groupCode: formatGroupCode(member.group.code),
    });
  } catch (err) {
    next(err);
  }
});

// ── CHANGE A PARTNER'S PHONE ────────────────────────────────────────────────
supportRouter.patch('/partners/:userId/phone', async (req, res, next) => {
  try {
    requireSupport(req);
    const phone = String(req.body?.phone || '').replace(/[^0-9]/g, '');
    if (!/^[0-9]{10,15}$/.test(phone)) throw new HttpError(400, 'Enter a valid phone number');

    const member = await prisma.ledgerMember.findUnique({ where: { userId: req.params.userId }, include: { user: true } });
    if (!member) throw new HttpError(404, 'No Ledger+ partner with that id');
    const previous = member.user.phone;
    if (previous === phone) throw new HttpError(400, 'That is already their number');

    try {
      await transaction(async (tx) => {
        await usersRepo.updateProfile(member.userId, { phone }, tx);
        await logSupport(member.groupId, 'support.phone_changed', member.userId, {
          partnerName: member.user.name, previous, updated: phone,
        }, tx);
      });
    } catch (err) {
      // (groupId, phone) is unique - the other partner may already hold this number.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new HttpError(409, 'The other partner already uses that number');
      }
      throw err;
    }

    res.json({ ok: true, phone });
  } catch (err) {
    next(err);
  }
});

// ── RESET A PARTNER'S PIN ───────────────────────────────────────────────────
supportRouter.patch('/partners/:userId/pin', async (req, res, next) => {
  try {
    requireSupport(req);
    const pin = String(req.body?.pin || '');
    if (!isValidPin(pin)) throw new HttpError(400, 'PIN must be 4 to 6 digits');

    const member = await prisma.ledgerMember.findUnique({ where: { userId: req.params.userId }, include: { user: true } });
    if (!member) throw new HttpError(404, 'No Ledger+ partner with that id');

    await transaction(async (tx) => {
      await usersRepo.updatePasswordHash(member.userId, hashPin(pin), tx);
      // Every device holding the old PIN's session is signed out. Leaving them live would
      // mean the reset had not really taken effect anywhere it mattered.
      await sessionsRepo.revokeAllForUser(member.userId, {}, tx);
      // The new PIN itself is never logged - only that it was reset, and by whom.
      await logSupport(member.groupId, 'support.pin_reset', member.userId, {
        partnerName: member.user.name,
      }, tx);
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── CHANGE A GROUP CODE OR BUSINESS NAME ────────────────────────────────────
supportRouter.patch('/partnerships/:groupId', async (req, res, next) => {
  try {
    requireSupport(req);
    const group = await prisma.group.findUnique({ where: { id: req.params.groupId } });
    if (!group) throw new HttpError(404, 'No partnership with that id');

    const isLedger = (await prisma.ledgerMember.count({ where: { groupId: group.id } })) > 0;
    if (!isLedger) throw new HttpError(404, 'No partnership with that id');

    const body = req.body ?? {};
    const data: { code?: string; name?: string } = {};
    const details: Record<string, unknown> = {};

    if (body.code !== undefined) {
      const code = normalizeGroupCode(body.code);
      if (code.length < 4 || code.length > 12) throw new HttpError(400, 'A group code is 4 to 12 letters or digits');
      if (code !== group.code) {
        data.code = code;
        details.previousCode = group.code;
        details.updatedCode = code;
      }
    }

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name || name.length > 80) throw new HttpError(400, 'Enter a business name of up to 80 characters');
      if (name !== group.name) {
        data.name = name;
        details.previousName = group.name;
        details.updatedName = name;
      }
    }

    if (Object.keys(data).length === 0) throw new HttpError(400, 'Nothing to change');

    try {
      await transaction(async (tx) => {
        await tx.group.update({ where: { id: group.id }, data });
        await logSupport(group.id, 'support.partnership_updated', group.id, details as Prisma.InputJsonValue, tx);
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new HttpError(409, 'Another group already uses that code');
      }
      throw err;
    }

    // Both partners' screens show the group code; push so it updates without a re-login.
    broadcast(group.code, 'session-changed', { reason: 'support-update' });
    if (data.code) broadcast(data.code, 'session-changed', { reason: 'support-update' });

    res.json({
      ok: true,
      code: data.code ?? group.code,
      displayCode: formatGroupCode(data.code ?? group.code),
      name: data.name ?? group.name,
    });
  } catch (err) {
    next(err);
  }
});

// ── FREEZE / UNFREEZE ───────────────────────────────────────────────────────
// Locks a client out of everything except unlocking and signing out. Not a soft warning: with
// `frozen` set, blockIfFrozen() refuses every ledger route with a 423, so it holds against the
// API directly and not merely in the app's UI.
supportRouter.patch('/partnerships/:groupId/frozen', async (req, res, next) => {
  try {
    requireSupport(req);
    const frozen = req.body?.frozen === true;

    const group = await prisma.group.findUnique({ where: { id: req.params.groupId } });
    if (!group) throw new HttpError(404, 'No partnership with that id');
    if ((await prisma.ledgerMember.count({ where: { groupId: group.id } })) === 0) {
      // The database is shared with the Trackmarg transport app; its groups are not this
      // console's to freeze.
      throw new HttpError(404, 'No partnership with that id');
    }
    if (group.frozen === frozen) {
      throw new HttpError(409, frozen ? 'Already frozen' : 'Not currently frozen');
    }

    await transaction(async (tx) => {
      await tx.group.update({ where: { id: group.id }, data: { frozen } });
      await logSupport(group.id, frozen ? 'support.frozen' : 'support.unfrozen', group.id, {
        groupCode: group.code,
        name: group.name,
      }, tx);
    });

    // Pushed down the SSE channel, which deliberately stays open while frozen - so every
    // device the client has open locks (or is released) at once, without a reload.
    broadcast(group.code, frozen ? 'account-frozen' : 'account-unfrozen', {});
    res.json({ ok: true, frozen });
  } catch (err) {
    next(err);
  }
});

// ── AUDIT TRAIL FOR ONE PARTNERSHIP ─────────────────────────────────────────
supportRouter.get('/partnerships/:groupId/audit', async (req, res, next) => {
  try {
    requireSupport(req);
    const rows = await auditLogsRepo.listByGroup(req.params.groupId, 60);
    res.json({
      entries: rows.map((row) => ({
        id: row.id,
        action: row.action,
        userName: row.userName,
        details: row.details,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});
