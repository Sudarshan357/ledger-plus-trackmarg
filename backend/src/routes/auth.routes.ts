import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import * as groupsRepo from '../db/repositories/groups.repository.js';
import * as usersRepo from '../db/repositories/users.repository.js';
import * as membersRepo from '../db/repositories/members.repository.js';
import * as ledgerSessionsRepo from '../db/repositories/ledgerSessions.repository.js';
import * as auditLogsRepo from '../db/repositories/auditLogs.repository.js';
import { hashPin, verifyPin, isValidPin } from '../services/passwords.js';
import { issueSession } from '../services/tokens.js';
import { generateGroupCode, generateUserCode, normalizeGroupCode } from '../services/codes.js';
import { serializeGroup, serializeUser } from '../services/serializers.js';
import { registerLimiter, loginLimiter } from '../middleware/rateLimit.js';
import { HttpError } from '../middleware/errorHandler.js';
import { broadcast } from '../services/sse.js';

export const authRouter = Router();

const MAX_PARTNERS = 2;

function normalizePhone(value: unknown): string {
  return String(value || '').replace(/[^0-9]/g, '');
}

function validateIdentity(name: string, phone: string): void {
  if (!name) throw new HttpError(400, 'Enter your full name');
  if (name.length > 60) throw new HttpError(400, 'That name is too long');
  if (!/^[0-9]{10,15}$/.test(phone)) throw new HttpError(400, 'Enter a valid phone number');
}

function validatePinPair(pin: string, confirmPin: string): void {
  if (!isValidPin(pin)) throw new HttpError(400, 'PIN must be 4 to 6 digits');
  if (pin !== confirmPin) throw new HttpError(400, 'The two PINs do not match');
}

// ── REGISTER ────────────────────────────────────────────────────────────────
// Two modes on one endpoint, because they are the same act from the user's point of view -
// starting a partnership vs. joining the one your partner already started.
authRouter.post('/register', registerLimiter, async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const mode = body.mode === 'create' ? 'create' : 'join';
    const name = String(body.name || '').trim();
    const phone = normalizePhone(body.phone);
    const pin = String(body.pin || '');
    const confirmPin = String(body.confirmPin || '');
    const requestedCode = normalizeGroupCode(body.groupCode);

    validateIdentity(name, phone);
    validatePinPair(pin, confirmPin);
    if (mode === 'join' && !requestedCode) throw new HttpError(400, 'Enter the group code your partner shared');

    const result = await prisma.$transaction(async (tx) => {
      let group;
      let memberRole: 'owner' | 'partner';

      if (mode === 'create') {
        let code = generateGroupCode();
        while (await groupsRepo.existsByCode(code, tx)) code = generateGroupCode();
        group = await groupsRepo.create(
          { code, name: String(body.businessName || '').trim() || `${name}'s Partnership` },
          tx,
        );
        memberRole = 'owner';
      } else {
        const found = await groupsRepo.findByCode(requestedCode, tx);
        // Deliberately the same message for "no such code" and "that code is a transport
        // group, not a partnership" - distinguishing them would let someone probe which
        // Trackmarg group codes exist.
        if (!found) throw new HttpError(404, 'That group code was not found');
        const memberCount = await membersRepo.countByGroup(found.id, tx);
        if (memberCount === 0) throw new HttpError(404, 'That group code was not found');
        if (memberCount >= MAX_PARTNERS) {
          throw new HttpError(409, 'This partnership already has two partners');
        }
        group = found;
        memberRole = 'partner';
      }

      if (group.frozen) throw new HttpError(423, 'This group is frozen. Contact support.');

      const duplicate = await usersRepo.findByGroupAndPhone(group.id, phone, tx);
      if (duplicate) throw new HttpError(409, 'That phone number is already registered in this partnership');

      let userCode = generateUserCode();
      while (await usersRepo.existsByUserCode(userCode, tx)) userCode = generateUserCode();

      const user = await usersRepo.create(
        { groupId: group.id, name, phone, userCode, passwordHash: hashPin(pin) },
        tx,
      );
      await membersRepo.create({ groupId: group.id, userId: user.id, role: memberRole }, tx);

      // Every partnership always has exactly one live session, from its first moment - so
      // the very first transaction has somewhere to belong without a special case.
      const session = await ledgerSessionsRepo.ensureActive(group.id, tx);

      await auditLogsRepo.create(
        {
          groupId: group.id,
          sessionId: session.id,
          userId: user.id,
          userName: user.name,
          action: mode === 'create' ? 'partnership.created' : 'partner.joined',
          entityId: user.id,
          details: { groupCode: group.code, role: memberRole },
        },
        tx,
      );

      const token = await issueSession({ id: user.id, groupId: group.id }, tx, {
        userAgent: req.headers['user-agent'],
        ip: req.ip,
      });

      return { token, user, group, mode };
    });

    // Tell the partner already in the group that someone joined, so their Partners list and
    // settlement figures update without a manual refresh.
    if (result.mode === 'join') {
      broadcast(result.group.code, 'partner-joined', { name: result.user.name });
    }

    res.status(201).json({
      token: result.token,
      user: serializeUser(result.user, result.group),
      group: serializeGroup(result.group),
    });
  } catch (err) {
    next(err);
  }
});

// ── LOGIN ───────────────────────────────────────────────────────────────────
authRouter.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const phone = normalizePhone(body.phone);
    const pin = String(body.pin || '');
    const groupCode = normalizeGroupCode(body.groupCode);

    if (!phone || !pin || !groupCode) {
      throw new HttpError(400, 'Group code, phone number and PIN are required');
    }

    // One generic message for every failure below. A more helpful "no such group code" would
    // turn this endpoint into a way to enumerate valid Trackmarg groups.
    const invalid = () => new HttpError(401, 'Invalid group code, phone number, or PIN');

    const group = await groupsRepo.findByCode(groupCode);
    if (!group) throw invalid();
    if (group.frozen) throw new HttpError(423, 'This account has been frozen by support.', 'ACCOUNT_FROZEN');

    const user = await usersRepo.findActiveByGroupAndPhone(group.id, phone);
    if (!user || !verifyPin(pin, user.passwordHash)) throw invalid();

    const member = await membersRepo.findByUserId(user.id);
    if (!member || member.groupId !== group.id) throw invalid();

    await ledgerSessionsRepo.ensureActive(group.id);

    const token = await issueSession({ id: user.id, groupId: group.id }, prisma, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });

    res.status(200).json({
      token,
      user: serializeUser(user, group),
      group: serializeGroup(group),
    });
  } catch (err) {
    next(err);
  }
});
