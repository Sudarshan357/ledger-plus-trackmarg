import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import * as usersRepo from '../db/repositories/users.repository.js';
import * as membersRepo from '../db/repositories/members.repository.js';
import * as sessionsRepo from '../db/repositories/sessions.repository.js';
import * as ledgerSessionsRepo from '../db/repositories/ledgerSessions.repository.js';
import * as auditLogsRepo from '../db/repositories/auditLogs.repository.js';
import { hashPin, verifyPin, isValidPin } from '../services/passwords.js';
import { serializeGroup, serializePartner, serializeSession, serializeUser } from '../services/serializers.js';
import { unlockLimiter, changePinLimiter } from '../middleware/rateLimit.js';
import { HttpError } from '../middleware/errorHandler.js';
import { auth } from '../middleware/auth.js';

export const accountRouter = Router();

/// Everything the app needs to boot: who I am, which partnership, who else is in it, and
/// which accounting session is live.
accountRouter.get('/me', async (req, res, next) => {
  try {
    const { user, group, groupId, member } = auth(req);
    const [partners, session] = await Promise.all([
      membersRepo.listByGroup(groupId),
      ledgerSessionsRepo.ensureActive(groupId),
    ]);
    res.json({
      user: serializeUser(user, group),
      group: serializeGroup(group),
      role: member.role,
      partners: partners.map(serializePartner),
      session: serializeSession(session),
    });
  } catch (err) {
    next(err);
  }
});

/// Backs "Lock App". The lock screen holds no ledger data and will not render any until this
/// call succeeds, so unlocking is a real server-side PIN check rather than a UI flag the
/// client could flip on its own.
accountRouter.post('/unlock', unlockLimiter, async (req, res, next) => {
  try {
    const { user } = auth(req);
    const pin = String((req.body ?? {}).pin || '');
    if (!verifyPin(pin, user.passwordHash)) throw new HttpError(401, 'Incorrect PIN');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

accountRouter.post('/change-pin', changePinLimiter, async (req, res, next) => {
  try {
    const { user, groupId, tokenHash } = auth(req);
    const body = req.body ?? {};
    const currentPin = String(body.currentPin || '');
    const newPin = String(body.newPin || '');
    const confirmPin = String(body.confirmPin || '');

    if (!verifyPin(currentPin, user.passwordHash)) throw new HttpError(401, 'Your current PIN is incorrect');
    if (!isValidPin(newPin)) throw new HttpError(400, 'PIN must be 4 to 6 digits');
    if (newPin !== confirmPin) throw new HttpError(400, 'The two PINs do not match');
    if (newPin === currentPin) throw new HttpError(400, 'Choose a PIN different from your current one');

    await prisma.$transaction(async (tx) => {
      await usersRepo.updatePasswordHash(user.id, hashPin(newPin), tx);
      // Every other device is logged out. A session opened under the old PIN outliving the
      // change would defeat the point of changing it.
      await sessionsRepo.revokeAllForUser(user.id, { exceptTokenHash: tokenHash }, tx);
      await auditLogsRepo.create(
        { groupId, userId: user.id, userName: user.name, action: 'pin.changed', entityId: user.id },
        tx,
      );
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

accountRouter.post('/logout', async (req, res, next) => {
  try {
    const { tokenHash } = auth(req);
    await sessionsRepo.revokeByTokenHash(tokenHash);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
