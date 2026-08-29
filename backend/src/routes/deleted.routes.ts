import { Router } from 'express';
import { transaction, prisma } from '../db/prisma.js';
import * as transactionsRepo from '../db/repositories/transactions.repository.js';
import * as ledgerSessionsRepo from '../db/repositories/ledgerSessions.repository.js';
import * as auditLogsRepo from '../db/repositories/auditLogs.repository.js';
import { serializeTransaction } from '../services/serializers.js';
import { loadPartners } from '../services/ledgerQueries.js';
import { HttpError } from '../middleware/errorHandler.js';
import { auth } from '../middleware/auth.js';
import { actorOf, broadcast } from '../services/sse.js';

export const deletedRouter = Router();

// The two-person rule, in one place:
//
//     A deletes  ->  only B can destroy it
//     B deletes  ->  only A can destroy it
//
// The point is that no single partner can both remove a financial record and erase the
// evidence. It is enforced here, on the server, from the token identity - the UI hides the
// button as well, but hiding a button is not a rule.
function canPermanentlyDelete(deletedById: string | null, viewerId: string): boolean {
  return deletedById !== null && deletedById !== viewerId;
}

// ── LIST ────────────────────────────────────────────────────────────────────
deletedRouter.get('/', async (req, res, next) => {
  try {
    const { user, groupId } = auth(req);
    const [{ names }, rows, sessions] = await Promise.all([
      loadPartners(groupId),
      transactionsRepo.listDeleted(groupId),
      ledgerSessionsRepo.listByGroup(groupId),
    ]);
    const sessionSeq = new Map(sessions.map((s) => [s.id, s.seq]));

    res.json({
      records: rows.map((row) => ({
        ...serializeTransaction(row, names),
        sessionSeq: sessionSeq.get(row.sessionId) ?? null,
        sessionLabel: `Session #${String(sessionSeq.get(row.sessionId) ?? 0).padStart(3, '0')}`,
        canPermanentlyDelete: canPermanentlyDelete(row.deletedById, user.id),
        // Spelled out rather than inferred by the UI, so the reason a record is view-only is
        // always the server's answer and always says the same thing.
        status:
          row.deletedById === user.id
            ? 'Waiting for your partner to approve permanent deletion'
            : 'You can permanently delete this record',
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ── PERMANENT DELETE (stage two) ────────────────────────────────────────────
deletedRouter.delete('/:id', async (req, res, next) => {
  try {
    const { user, groupId, groupCode } = auth(req);

    const existing = await transactionsRepo.findByIdAndGroup(req.params.id, groupId);
    if (!existing) throw new HttpError(404, 'Record not found');
    if (!existing.deletedAt) {
      throw new HttpError(409, 'This record is still in the ledger. Delete it there first.');
    }
    if (!canPermanentlyDelete(existing.deletedById, user.id)) {
      throw new HttpError(
        403,
        'You deleted this record, so only your partner can permanently remove it.',
      );
    }

    const { names } = await loadPartners(groupId);

    await transaction(async (tx) => {
      // The audit entry is written BEFORE the row goes, and carries a full snapshot of it.
      // Once the delete lands this is the only remaining trace that the money ever existed,
      // which is exactly why it must not depend on the row still being there.
      await auditLogsRepo.create(
        {
          groupId,
          sessionId: existing.sessionId,
          userId: user.id,
          userName: user.name,
          action: 'transaction.permanently_deleted',
          entityId: existing.id,
          details: {
            originalTransactionId: existing.id,
            type: existing.type,
            category: existing.category,
            amount: existing.amount.toFixed(2),
            date: existing.date.toISOString().slice(0, 10),
            notes: existing.notes,
            ownerId: existing.ownerId,
            ownerName: names.get(existing.ownerId) ?? 'Former partner',
            createdAt: existing.createdAt.toISOString(),
            deletedById: existing.deletedById,
            deletedByName: existing.deletedById ? names.get(existing.deletedById) ?? 'Former partner' : null,
            deletedAt: existing.deletedAt?.toISOString() ?? null,
            permanentlyDeletedById: user.id,
            permanentlyDeletedByName: user.name,
            permanentlyDeletedAt: new Date().toISOString(),
            sessionId: existing.sessionId,
            groupId,
          },
        },
        tx,
      );
      await transactionsRepo.hardDelete(existing.id, tx);
    });

    broadcast(groupCode, 'ledger-changed', { reason: 'permanently-deleted', id: existing.id, actor: actorOf(req) });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
