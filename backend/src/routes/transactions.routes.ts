import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import * as transactionsRepo from '../db/repositories/transactions.repository.js';
import * as ledgerSessionsRepo from '../db/repositories/ledgerSessions.repository.js';
import * as auditLogsRepo from '../db/repositories/auditLogs.repository.js';
import * as membersRepo from '../db/repositories/members.repository.js';
import { isValidCategory, type TransactionType } from '../services/categories.js';
import { serializeSession, serializeTransaction, serializeSettlementComputation } from '../services/serializers.js';
import { loadActiveSnapshot, loadPartners } from '../services/ledgerQueries.js';
import { HttpError } from '../middleware/errorHandler.js';
import { auth } from '../middleware/auth.js';
import { actorOf, broadcast } from '../services/sse.js';

export const transactionsRouter = Router();

// Decimal(14,2) tops out at 999,999,999,999.99. Rejecting oversize amounts here gives a clear
// message instead of a database overflow error surfacing as a 500.
const MAX_AMOUNT = 999_999_999_999.99;

function parseAmount(value: unknown): string {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'Enter an amount greater than zero');
  if (amount > MAX_AMOUNT) throw new HttpError(400, 'That amount is too large');
  return amount.toFixed(2);
}

/// Accepts only YYYY-MM-DD and builds the Date at UTC midnight, matching how the DATE column
/// is read back. Letting Date parse a free-form string would shift the day for anyone not on
/// UTC - a transaction dated the 21st showing up on the 20th in a partnership ledger is the
/// kind of bug that costs an evening of reconciliation.
function parseDate(value: unknown): Date {
  const raw = String(value || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) throw new HttpError(400, 'Enter a valid date');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) throw new HttpError(400, 'Enter a valid date');
  return date;
}

function parseType(value: unknown): TransactionType {
  if (value === 'received' || value === 'expense') return value;
  throw new HttpError(400, 'Choose Received or Expense');
}

function parseNotes(value: unknown): string {
  const notes = String(value ?? '').trim();
  if (notes.length > 500) throw new HttpError(400, 'Notes are too long (500 characters max)');
  return notes;
}

/// Resolves whose entry this is. A partner may record on behalf of the other - one person
/// often keeps the books for both - but only for someone who is actually a partner in THIS
/// partnership, checked against the database rather than taken on trust.
///
/// What is never negotiable is `createdById`: that always comes from the verified token, so
/// however an entry is attributed, the record of who physically typed it cannot be forged.
async function resolveOwner(
  rawOwnerId: unknown,
  self: { id: string; name: string },
  groupId: string,
): Promise<{ ownerId: string; ownerName: string }> {
  const requested = rawOwnerId === undefined || rawOwnerId === null ? '' : String(rawOwnerId);
  if (!requested || requested === self.id) return { ownerId: self.id, ownerName: self.name };

  const member = await membersRepo.findInGroup(groupId, requested);
  if (!member) throw new HttpError(400, 'That partner is not part of this partnership');
  return { ownerId: member.userId, ownerName: member.user.name };
}

/// Who may change an entry once it exists: the partner who recorded it, or the partner whose
/// entry it is.
///
/// Both, deliberately. Restricting it to the creator would let one partner load entries onto
/// the other's side of the books with no way for them to push back - which is precisely the
/// imbalance this app exists to prevent. Widening it costs nothing in safety, because
/// deleting still only moves a record to Deleted Records, and the two-person rule there is
/// untouched: whoever deletes it, the OTHER partner is the only one who can destroy it.
function mayModify(txn: { ownerId: string; createdById: string }, userId: string): boolean {
  return txn.createdById === userId || txn.ownerId === userId;
}

// ── LIST ────────────────────────────────────────────────────────────────────
// scope=session (default) is the current accounting session, which is what the Ledger screen
// shows; scope=all spans every session and backs CSV export.
transactionsRouter.get('/', async (req, res, next) => {
  try {
    const { groupId } = auth(req);
    const scope = req.query.scope === 'all' ? 'all' : 'session';
    const { names } = await loadPartners(groupId);
    const session = await ledgerSessionsRepo.ensureActive(groupId);

    const rows =
      scope === 'all'
        ? await transactionsRepo.listLiveByGroup(groupId)
        : await transactionsRepo.listLive(groupId, session.id);

    res.json({
      session: serializeSession(session),
      transactions: rows.map((row) => serializeTransaction(row, names)),
    });
  } catch (err) {
    next(err);
  }
});

// ── OVERVIEW (Home screen) ──────────────────────────────────────────────────
transactionsRouter.get('/overview', async (req, res, next) => {
  try {
    const { groupId } = auth(req);
    const { session, computation, names } = await loadActiveSnapshot(groupId);
    const rows = await transactionsRepo.listLive(groupId, session.id);
    res.json({
      session: serializeSession(session),
      ...serializeSettlementComputation(computation),
      transactionCount: rows.length,
    });
  } catch (err) {
    next(err);
  }
});

// ── CREATE ──────────────────────────────────────────────────────────────────
transactionsRouter.post('/', async (req, res, next) => {
  try {
    const { user, groupId, groupCode } = auth(req);
    const body = req.body ?? {};

    const type = parseType(body.type);
    const category = String(body.category || '').trim();
    if (!isValidCategory(type, category)) throw new HttpError(400, 'Choose a valid category');

    const amount = parseAmount(body.amount);
    const date = parseDate(body.date);
    const notes = parseNotes(body.notes);
    const { ownerId, ownerName } = await resolveOwner(body.ownerId, user, groupId);
    const onBehalf = ownerId !== user.id;

    const created = await prisma.$transaction(async (tx) => {
      const session = await ledgerSessionsRepo.ensureActive(groupId, tx);
      const row = await transactionsRepo.create(
        {
          groupId,
          sessionId: session.id,
          // The owner may be either partner (validated above). The creator never can be:
          // it is read from the verified token and nothing in the request body can move it.
          ownerId,
          createdById: user.id,
          type,
          category,
          amount,
          date,
          notes,
        },
        tx,
      );
      await auditLogsRepo.create(
        {
          groupId,
          sessionId: session.id,
          userId: user.id,
          userName: user.name,
          action: onBehalf ? 'transaction.created_on_behalf' : 'transaction.created',
          entityId: row.id,
          details: {
            type,
            category,
            amount,
            date: date.toISOString().slice(0, 10),
            ownerId,
            ownerName,
            ...(onBehalf ? { recordedBy: user.name } : {}),
          },
        },
        tx,
      );
      return row;
    });

    // The only names the serializer can need are the creator's and the owner's, and both are
    // already in hand - no extra query to render the row that was just written.
    const names = new Map([
      [user.id, user.name],
      [ownerId, ownerName],
    ]);
    broadcast(groupCode, 'ledger-changed', { reason: 'created', id: created.id, actor: actorOf(req) });
    res.status(201).json({ transaction: serializeTransaction(created, names) });
  } catch (err) {
    next(err);
  }
});

// ── UPDATE (own transactions only) ──────────────────────────────────────────
transactionsRouter.patch('/:id', async (req, res, next) => {
  try {
    const { user, groupId, groupCode } = auth(req);
    const body = req.body ?? {};

    const existing = await transactionsRepo.findByIdAndGroup(req.params.id, groupId);
    if (!existing) throw new HttpError(404, 'Transaction not found');
    if (existing.deletedAt) throw new HttpError(409, 'This record is in Deleted Records and cannot be edited');
    if (!mayModify(existing, user.id)) {
      throw new HttpError(403, 'You can only change entries you recorded or that are yours');
    }

    const type = body.type === undefined ? (existing.type as TransactionType) : parseType(body.type);
    const category = body.category === undefined ? existing.category : String(body.category || '').trim();
    if (!isValidCategory(type, category)) throw new HttpError(400, 'Choose a valid category');

    const updated = await prisma.$transaction(async (tx) => {
      const row = await transactionsRepo.update(
        existing.id,
        {
          type,
          category,
          ...(body.amount === undefined ? {} : { amount: parseAmount(body.amount) }),
          ...(body.date === undefined ? {} : { date: parseDate(body.date) }),
          ...(body.notes === undefined ? {} : { notes: parseNotes(body.notes) }),
          updatedById: user.id,
        },
        tx,
      );
      await auditLogsRepo.create(
        {
          groupId,
          sessionId: existing.sessionId,
          userId: user.id,
          userName: user.name,
          action: 'transaction.updated',
          entityId: row.id,
          details: { type: row.type, category: row.category, amount: row.amount.toFixed(2) },
        },
        tx,
      );
      return row;
    });

    const { names } = await loadPartners(groupId);
    broadcast(groupCode, 'ledger-changed', { reason: 'updated', id: updated.id, actor: actorOf(req) });
    res.json({ transaction: serializeTransaction(updated, names) });
  } catch (err) {
    next(err);
  }
});

// ── DELETE (stage one: move to Deleted Records) ─────────────────────────────
transactionsRouter.delete('/:id', async (req, res, next) => {
  try {
    const { user, groupId, groupCode } = auth(req);

    const existing = await transactionsRepo.findByIdAndGroup(req.params.id, groupId);
    if (!existing) throw new HttpError(404, 'Transaction not found');
    if (existing.deletedAt) throw new HttpError(409, 'This record is already in Deleted Records');
    if (!mayModify(existing, user.id)) {
      throw new HttpError(403, 'You can only delete entries you recorded or that are yours');
    }

    await prisma.$transaction(async (tx) => {
      await transactionsRepo.softDelete(existing.id, user.id, tx);
      await auditLogsRepo.create(
        {
          groupId,
          sessionId: existing.sessionId,
          userId: user.id,
          userName: user.name,
          action: 'transaction.deleted',
          entityId: existing.id,
          details: {
            type: existing.type,
            category: existing.category,
            amount: existing.amount.toFixed(2),
          },
        },
        tx,
      );
    });

    broadcast(groupCode, 'ledger-changed', { reason: 'deleted', id: existing.id, actor: actorOf(req) });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
