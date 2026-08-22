import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { LONG_TX, prisma } from '../db/prisma.js';
import * as ledgerSessionsRepo from '../db/repositories/ledgerSessions.repository.js';
import * as settlementsRepo from '../db/repositories/settlements.repository.js';
import * as transactionsRepo from '../db/repositories/transactions.repository.js';
import * as auditLogsRepo from '../db/repositories/auditLogs.repository.js';
import * as membersRepo from '../db/repositories/members.repository.js';
import {
  serializeSession,
  serializeSettlement,
  serializeSettlementComputation,
} from '../services/serializers.js';
import { loadActiveSnapshot } from '../services/ledgerQueries.js';
import { closeActiveSession, markSettlementPaid } from '../services/settlementActions.js';
import { HttpError } from '../middleware/errorHandler.js';
import { auth } from '../middleware/auth.js';
import { actorOf, broadcast } from '../services/sse.js';

export const settlementRouter = Router();

// ── PREVIEW (the Record Settle screen) ──────────────────────────────────────
// Nothing is written here. This is the same computation that gets frozen on close, run live,
// so what a partner approves is exactly what gets stored.
settlementRouter.get('/preview', async (req, res, next) => {
  try {
    const { groupId } = auth(req);
    const { session, computation } = await loadActiveSnapshot(groupId);
    const count = await transactionsRepo.countInSession(groupId, session.id);
    res.json({
      session: serializeSession(session),
      ...serializeSettlementComputation(computation),
      transactionCount: count,
    });
  } catch (err) {
    next(err);
  }
});

// ── HISTORY ─────────────────────────────────────────────────────────────────
settlementRouter.get('/history', async (req, res, next) => {
  try {
    const { groupId } = auth(req);
    const rows = await settlementsRepo.listByGroup(groupId);
    res.json({ settlements: rows.map(serializeSettlement) });
  } catch (err) {
    next(err);
  }
});

/// A closed session's full, read-only report. The stored `summary` snapshot is what is shown,
/// not a recomputation - a historical settlement must never change because something in the
/// live ledger did.
settlementRouter.get('/history/:id', async (req, res, next) => {
  try {
    const { groupId } = auth(req);
    const settlement = await settlementsRepo.findByIdAndGroup(req.params.id, groupId);
    if (!settlement) throw new HttpError(404, 'Settlement not found');
    res.json({ settlement: serializeSettlement(settlement) });
  } catch (err) {
    next(err);
  }
});

// ── CLOSE / START FRESH SESSION ─────────────────────────────────────────────
// The close itself now lives in services/settlementActions.ts and normally runs only once the
// other partner has approved it - see routes/approvals.routes.ts. This endpoint stays as the
// direct path for a partnership that has just one member, where there is nobody to ask.
settlementRouter.post('/close', async (req, res, next) => {
  try {
    const { user, groupId, groupCode } = auth(req);

    const memberCount = await membersRepo.countByGroup(groupId);
    if (memberCount >= 2) {
      throw new HttpError(
        409,
        'Starting a fresh session needs your partner to approve it. Send the request from Record Settle.',
      );
    }

    const result = await prisma.$transaction(
      (tx) => closeActiveSession(groupId, groupCode, { id: user.id, name: user.name }, tx),
      LONG_TX,
    );

    broadcast(groupCode, 'session-changed', { reason: 'settled', actor: actorOf(req) });
    res.status(201).json({
      settlement: serializeSettlement(result.settlement),
      session: serializeSession(result.next),
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      next(new HttpError(409, 'This session was just settled on another device. Pull to refresh.'));
      return;
    }
    next(err);
  }
});

// ── MARK THE PAYMENT AS MADE ────────────────────────────────────────────────
// Calculating who owes whom and the money actually moving are two different events, and until
// now the ledger could only tell you about the first. Either partner may record it; who did
// and when is kept, so it is a statement someone made rather than an anonymous flag.
settlementRouter.post('/history/:id/paid', async (req, res, next) => {
  try {
    const { user, groupId, groupCode } = auth(req);

    // With two partners this needs the other one to agree, the same as closing or amending -
    // see routes/approvals.routes.ts. This stays as the direct path for a solo partnership.
    if ((await membersRepo.countByGroup(groupId)) >= 2) {
      throw new HttpError(
        409,
        'Confirming a payment needs your partner to approve it. Send the request from the settlement.',
      );
    }

    const updated = await prisma.$transaction(
      (tx) => markSettlementPaid(groupId, req.params.id, { id: user.id, name: user.name }, tx),
      LONG_TX,
    );

    broadcast(groupCode, 'session-changed', { reason: 'settlement-paid', actor: actorOf(req) });
    res.json({ settlement: serializeSettlement(updated) });
  } catch (err) {
    next(err);
  }
});

/// Undo, for the mis-tap. Recorded too - a payment that was marked and then unmarked is
/// exactly the kind of thing the other partner should be able to see.
settlementRouter.delete('/history/:id/paid', async (req, res, next) => {
  try {
    const { user, groupId, groupCode } = auth(req);
    const settlement = await settlementsRepo.findByIdAndGroup(req.params.id, groupId);
    if (!settlement) throw new HttpError(404, 'Settlement not found');
    if (!settlement.paidAt) throw new HttpError(409, 'This settlement is not marked as paid.');

    const updated = await prisma.$transaction(async (tx) => {
      const row = await settlementsRepo.setPaid(settlement.id, null, tx);
      await auditLogsRepo.create({
        groupId, sessionId: settlement.sessionId, userId: user.id, userName: user.name,
        action: 'settlement.unmarked_paid', entityId: settlement.id,
      }, tx);
      return row;
    });

    broadcast(groupCode, 'session-changed', { reason: 'settlement-paid', actor: actorOf(req) });
    res.json({ settlement: serializeSettlement(updated) });
  } catch (err) {
    next(err);
  }
});
