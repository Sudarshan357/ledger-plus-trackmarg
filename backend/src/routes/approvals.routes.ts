import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { transaction, prisma } from '../db/prisma.js';
import * as approvalsRepo from '../db/repositories/approvals.repository.js';
import * as membersRepo from '../db/repositories/members.repository.js';
import * as settlementsRepo from '../db/repositories/settlements.repository.js';
import * as transactionsRepo from '../db/repositories/transactions.repository.js';
import * as ledgerSessionsRepo from '../db/repositories/ledgerSessions.repository.js';
import * as auditLogsRepo from '../db/repositories/auditLogs.repository.js';
import { isValidCategory, type TransactionType } from '../services/categories.js';
import {
  amendSettlement,
  closeActiveSession,
  markSettlementPaid,
  type AmendEntry,
} from '../services/settlementActions.js';
import { applyTransactionEdit } from '../services/transactionActions.js';
import { loadPartners } from '../services/ledgerQueries.js';
import {
  serializeApproval,
  serializeSession,
  serializeSettlement,
  serializeTransaction,
} from '../services/serializers.js';
import { HttpError } from '../middleware/errorHandler.js';
import { auth } from '../middleware/auth.js';
import { actorOf, broadcast } from '../services/sse.js';

export const approvalsRouter = Router();

// Closing a session and amending a settled one both rewrite what the two partners have agreed
// the money is, so neither happens on one person's say-so. A request is recorded, the other
// partner decides, and only then is anything written to the ledger.
//
// The one exception is a partnership with a single member. Requiring a second person when
// there is no second person is not a safeguard, it is a deadlock - so those act immediately.

const MAX_AMOUNT = 999_999_999_999.99;

function parseAmount(value: unknown): string {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'Enter an amount greater than zero');
  if (amount > MAX_AMOUNT) throw new HttpError(400, 'That amount is too large');
  return amount.toFixed(2);
}

function parseDate(value: unknown): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) throw new HttpError(400, 'Enter a valid date');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) throw new HttpError(400, 'Enter a valid date');
  return date;
}

async function assertNoPending(groupId: string): Promise<void> {
  if (await approvalsRepo.findPending(groupId)) {
    throw new HttpError(409, 'There is already a request waiting for a decision.');
  }
}

// ── WHAT IS WAITING ─────────────────────────────────────────────────────────
approvalsRouter.get('/pending', async (req, res, next) => {
  try {
    const { groupId, user } = auth(req);
    const pending = await approvalsRepo.findPending(groupId);
    if (!pending) return res.json({ approval: null });
    const { names } = await loadPartners(groupId);
    res.json({ approval: serializeApproval(pending, names, user.id) });
  } catch (err) {
    next(err);
  }
});

// ── REQUEST: START A FRESH SESSION ──────────────────────────────────────────
approvalsRouter.post('/close-session', async (req, res, next) => {
  try {
    const { user, groupId, groupCode } = auth(req);
    await assertNoPending(groupId);

    const session = await ledgerSessionsRepo.findActive(groupId);
    if (!session) throw new HttpError(409, 'This session has already been settled.');
    const count = await transactionsRepo.countInSession(groupId, session.id);
    if (count === 0) throw new HttpError(400, 'There is nothing to settle yet - add some entries first.');

    const memberCount = await membersRepo.countByGroup(groupId);

    // Solo partnership: nobody to ask, so do it now.
    if (memberCount < 2) {
      const result = await transaction((tx) => closeActiveSession(groupId, groupCode, { id: user.id, name: user.name }, tx));
      broadcast(groupCode, 'session-changed', { reason: 'settled', actor: actorOf(req) });
      return res.status(201).json({
        applied: true,
        settlement: serializeSettlement(result.settlement),
        session: serializeSession(result.next),
      });
    }

    const approval = await approvalsRepo.create({
      groupId,
      kind: 'close_session',
      requestedById: user.id,
      sessionId: session.id,
      payload: { sessionSeq: session.seq, transactionCount: count },
    });
    await auditLogsRepo.create({
      groupId, sessionId: session.id, userId: user.id, userName: user.name,
      action: 'approval.requested', entityId: approval.id, details: { kind: 'close_session' },
    });

    // The other partner's device needs to surface the request without a manual refresh.
    broadcast(groupCode, 'session-changed', { reason: 'approval-requested', actor: actorOf(req) });
    res.status(202).json({ applied: false, approvalId: approval.id });
  } catch (err) {
    next(err);
  }
});

// ── REQUEST: AMEND A SETTLED SESSION ────────────────────────────────────────
approvalsRouter.post('/amend-settlement', async (req, res, next) => {
  try {
    const { user, groupId, groupCode } = auth(req);
    const body = req.body ?? {};
    await assertNoPending(groupId);

    const settlement = await settlementsRepo.findByIdAndGroup(String(body.settlementId || ''), groupId);
    if (!settlement) throw new HttpError(404, 'Settlement not found');

    const type: TransactionType = body.type === 'expense' ? 'expense' : body.type === 'received' ? 'received' : (() => {
      throw new HttpError(400, 'Choose Received or Expense');
    })();
    const category = String(body.category || '').trim();
    if (!isValidCategory(type, category)) throw new HttpError(400, 'Choose a valid category');

    // Same rule as a normal entry: the owner must be a partner here, and may be either of
    // them, but who requested it is taken from the session and never from the body.
    const ownerId = String(body.ownerId || '') || user.id;
    if (ownerId !== user.id && !(await membersRepo.findInGroup(groupId, ownerId))) {
      throw new HttpError(400, 'That partner is not part of this partnership');
    }

    const entry: AmendEntry = {
      type,
      category,
      amount: parseAmount(body.amount),
      date: parseDate(body.date),
      notes: String(body.notes ?? '').trim().slice(0, 500),
      ownerId,
    };

    const memberCount = await membersRepo.countByGroup(groupId);
    if (memberCount < 2) {
      const updated = await transaction((tx) => amendSettlement(groupId, groupCode, settlement.id, entry, { id: user.id, name: user.name }, tx));
      broadcast(groupCode, 'ledger-changed', { reason: 'amended', actor: actorOf(req) });
      return res.status(200).json({ applied: true, settlement: serializeSettlement(updated) });
    }

    const approval = await approvalsRepo.create({
      groupId,
      kind: 'amend_settlement',
      requestedById: user.id,
      settlementId: settlement.id,
      payload: {
        ...entry,
        date: entry.date.toISOString().slice(0, 10),
        settlementLabel: `Settlement #${String(settlement.seq).padStart(3, '0')}`,
      },
    });
    await auditLogsRepo.create({
      groupId, userId: user.id, userName: user.name,
      action: 'approval.requested', entityId: approval.id,
      details: { kind: 'amend_settlement', settlementId: settlement.id },
    });

    broadcast(groupCode, 'ledger-changed', { reason: 'approval-requested', actor: actorOf(req) });
    res.status(202).json({ applied: false, approvalId: approval.id });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      next(new HttpError(409, 'There is already a request waiting for a decision.'));
      return;
    }
    next(err);
  }
});

// ── REQUEST: CONFIRM THE PAYMENT WAS MADE ───────────────────────────────────
approvalsRouter.post('/mark-paid', async (req, res, next) => {
  try {
    const { user, groupId, groupCode } = auth(req);
    await assertNoPending(groupId);

    const settlement = await settlementsRepo.findByIdAndGroup(String(req.body?.settlementId || ''), groupId);
    if (!settlement) throw new HttpError(404, 'Settlement not found');
    if (settlement.paidAt) throw new HttpError(409, 'This settlement is already marked as paid.');
    if (Number(settlement.amount) === 0) {
      throw new HttpError(400, 'This settlement is already square - there is nothing to pay.');
    }

    const memberCount = await membersRepo.countByGroup(groupId);
    if (memberCount < 2) {
      const updated = await transaction((tx) => markSettlementPaid(groupId, settlement.id, { id: user.id, name: user.name }, tx));
      broadcast(groupCode, 'session-changed', { reason: 'settlement-paid', actor: actorOf(req) });
      return res.status(200).json({ applied: true, settlement: serializeSettlement(updated) });
    }

    const approval = await approvalsRepo.create({
      groupId,
      kind: 'mark_paid',
      requestedById: user.id,
      settlementId: settlement.id,
      payload: {
        settlementLabel: `Settlement #${String(settlement.seq).padStart(3, '0')}`,
        amount: settlement.amount.toFixed(2),
        fromUserName: settlement.fromUserName,
        toUserName: settlement.toUserName,
      },
    });
    await auditLogsRepo.create({
      groupId, sessionId: settlement.sessionId, userId: user.id, userName: user.name,
      action: 'approval.requested', entityId: approval.id,
      details: { kind: 'mark_paid', settlementId: settlement.id },
    });

    broadcast(groupCode, 'session-changed', { reason: 'approval-requested', actor: actorOf(req) });
    res.status(202).json({ applied: false, approvalId: approval.id });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      next(new HttpError(409, 'There is already a request waiting for a decision.'));
      return;
    }
    next(err);
  }
});

// ── DECIDE ──────────────────────────────────────────────────────────────────
approvalsRouter.post('/:id/approve', async (req, res, next) => {
  try {
    const { user, groupId, groupCode } = auth(req);
    const approval = await approvalsRepo.findByIdAndGroup(req.params.id, groupId);
    if (!approval) throw new HttpError(404, 'Request not found');
    if (approval.status !== 'pending') throw new HttpError(409, 'That request has already been decided.');

    // The heart of it: you cannot wave through your own request.
    if (approval.requestedById === user.id) {
      throw new HttpError(403, 'Your partner has to approve this, not you.');
    }

    const result = await transaction(async (tx) => {
      // Marking it decided first, conditional on it still being pending, means a double-tap
      // or a race cannot execute the change twice.
      const claimed = await approvalsRepo.decide(approval.id, 'approved', user.id, tx);
      if (!claimed) throw new HttpError(409, 'That request has already been decided.');

      const actor = { id: approval.requestedById, name: '' };
      const requester = await membersRepo.findByUserId(approval.requestedById, tx);
      actor.name = requester?.user.name ?? 'Former partner';

      if (approval.kind === 'close_session') {
        const closed = await closeActiveSession(groupId, groupCode, actor, tx);
        await auditLogsRepo.create({
          groupId, userId: user.id, userName: user.name,
          action: 'approval.approved', entityId: approval.id,
          details: { kind: approval.kind, requestedBy: actor.name },
        }, tx);
        return { kind: 'close_session' as const, settlement: closed.settlement, session: closed.next };
      }

      if (approval.kind === 'mark_paid') {
        // Credited to the partner who asserted it, not the one who agreed - the audit trail
        // should show who claimed the money moved.
        const paid = await markSettlementPaid(groupId, approval.settlementId!, actor, tx);
        await auditLogsRepo.create({
          groupId, userId: user.id, userName: user.name,
          action: 'approval.approved', entityId: approval.id,
          details: { kind: approval.kind, requestedBy: actor.name },
        }, tx);
        return { kind: 'mark_paid' as const, settlement: paid };
      }

      if (approval.kind === 'edit_transaction') {
        const existing = await transactionsRepo.findByIdAndGroup(approval.transactionId!, groupId, tx);
        if (!existing || existing.deletedAt) {
          throw new HttpError(409, 'This entry no longer exists - it may have been deleted since the request.');
        }
        const p = (
          approval.payload as {
            proposed: { type: 'received' | 'expense'; category: string; amount: string; date: string; notes: string };
          }
        ).proposed;
        // Credited to whoever asked for the change, not whoever agreed to it - same reasoning
        // as mark_paid: the audit trail should show who actually corrected the entry.
        const updated = await applyTransactionEdit(
          groupId, existing,
          { type: p.type, category: p.category, amount: p.amount, date: new Date(`${p.date}T00:00:00.000Z`), notes: p.notes },
          actor, tx,
        );
        await auditLogsRepo.create({
          groupId, userId: user.id, userName: user.name,
          action: 'approval.approved', entityId: approval.id,
          details: { kind: approval.kind, requestedBy: actor.name },
        }, tx);
        const { names } = await loadPartners(groupId, tx);
        return { kind: 'edit_transaction' as const, transaction: serializeTransaction(updated, names) };
      }

      const p = approval.payload as unknown as AmendEntry & { date: string };
      const updated = await amendSettlement(
        groupId, groupCode, approval.settlementId!,
        { ...p, date: new Date(`${p.date}T00:00:00.000Z`) },
        actor, tx,
      );
      await auditLogsRepo.create({
        groupId, userId: user.id, userName: user.name,
        action: 'approval.approved', entityId: approval.id,
        details: { kind: approval.kind, requestedBy: actor.name },
      }, tx);
      return { kind: 'amend_settlement' as const, settlement: updated };
    });

    broadcast(
      groupCode,
      result.kind === 'edit_transaction' ? 'ledger-changed' : 'session-changed',
      { reason: 'approval-approved', actor: actorOf(req) },
    );
    res.json({
      ok: true,
      kind: result.kind,
      ...(result.kind === 'edit_transaction'
        ? { transaction: result.transaction }
        : { settlement: serializeSettlement(result.settlement) }),
      ...(result.kind === 'close_session' ? { session: serializeSession(result.session) } : {}),
    });
  } catch (err) {
    next(err);
  }
});

approvalsRouter.post('/:id/reject', async (req, res, next) => {
  try {
    const { user, groupId, groupCode } = auth(req);
    const approval = await approvalsRepo.findByIdAndGroup(req.params.id, groupId);
    if (!approval) throw new HttpError(404, 'Request not found');
    if (approval.requestedById === user.id) {
      throw new HttpError(403, 'Cancel your own request instead of rejecting it.');
    }
    if (!(await approvalsRepo.decide(approval.id, 'rejected', user.id))) {
      throw new HttpError(409, 'That request has already been decided.');
    }
    await auditLogsRepo.create({
      groupId, userId: user.id, userName: user.name,
      action: 'approval.rejected', entityId: approval.id, details: { kind: approval.kind },
    });
    broadcast(groupCode, 'session-changed', { reason: 'approval-rejected', actor: actorOf(req) });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

approvalsRouter.post('/:id/cancel', async (req, res, next) => {
  try {
    const { user, groupId, groupCode } = auth(req);
    const approval = await approvalsRepo.findByIdAndGroup(req.params.id, groupId);
    if (!approval) throw new HttpError(404, 'Request not found');
    if (approval.requestedById !== user.id) {
      throw new HttpError(403, 'Only the partner who asked can withdraw this request.');
    }
    if (!(await approvalsRepo.decide(approval.id, 'cancelled', user.id))) {
      throw new HttpError(409, 'That request has already been decided.');
    }
    broadcast(groupCode, 'session-changed', { reason: 'approval-cancelled', actor: actorOf(req) });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
