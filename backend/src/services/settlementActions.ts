// The two operations that rewrite what a partnership has agreed its money is: closing the
// live session, and amending one that was already settled.
//
// They live here rather than in a route because each has two callers - performed directly
// (a single-partner group, where there is nobody to ask) or performed later by the approval
// that carried it. Both paths must do exactly the same thing, so there is exactly one copy.
import { Prisma } from '@prisma/client';
import type { LedgerSettlement, LedgerSession } from '@prisma/client';
import type { DbClient } from '../db/prisma.js';
import * as ledgerSessionsRepo from '../db/repositories/ledgerSessions.repository.js';
import * as settlementsRepo from '../db/repositories/settlements.repository.js';
import * as transactionsRepo from '../db/repositories/transactions.repository.js';
import * as auditLogsRepo from '../db/repositories/auditLogs.repository.js';
import { loadPartners } from './ledgerQueries.js';
import { computeSettlement, toRupees } from './money.js';
import { serializeTransaction } from './serializers.js';
import { HttpError } from '../middleware/errorHandler.js';

export interface Actor {
  id: string;
  name: string;
}

export interface AmendEntry {
  type: 'received' | 'expense';
  category: string;
  amount: string;
  date: Date;
  notes: string;
  ownerId: string;
}

/// Builds the frozen snapshot stored on a settlement. Shared by close and amend so an amended
/// settlement is shaped exactly like a freshly-closed one.
async function buildSummary(
  groupId: string,
  session: LedgerSession,
  groupCode: string,
  closedByName: string,
  client: DbClient,
) {
  const { partners, names } = await loadPartners(groupId, client);
  const rows = await transactionsRepo.listLive(groupId, session.id, client);
  const computation = computeSettlement(partners, rows);

  return {
    computation,
    rows,
    summary: {
      partners: computation.partners.map((partner) => ({
        userId: partner.userId,
        name: partner.name,
        received: toRupees(partner.received),
        expense: toRupees(partner.expense),
        net: toRupees(partner.net),
        shareBalance: toRupees(partner.shareBalance),
      })),
      transactions: rows.map((row) => serializeTransaction(row, names)),
      transactionCount: rows.length,
      groupCode,
      closedByName,
    },
  };
}

/// Closes the live session, freezes its settlement, and opens the next one at zero. The old
/// session's transactions stay exactly where they are - "fresh" means a new empty period,
/// never a deletion.
export async function closeActiveSession(
  groupId: string,
  groupCode: string,
  actor: Actor,
  tx: DbClient,
): Promise<{ settlement: LedgerSettlement; next: LedgerSession }> {
  // Lock the active session for this transaction. Two partners acting at the same instant
  // would otherwise each read the same live session and close it twice.
  await (tx as Prisma.TransactionClient).$queryRaw`
    SELECT "id" FROM "ledger"."LedgerSession"
    WHERE "groupId" = ${groupId} AND "status" = 'active'
    FOR UPDATE
  `;

  const active = await ledgerSessionsRepo.findActive(groupId, tx);
  if (!active) throw new HttpError(409, 'This session has already been settled. Pull to refresh.');

  const { computation, rows, summary } = await buildSummary(groupId, active, groupCode, actor.name, tx);
  if (rows.length === 0) {
    throw new HttpError(400, 'There is nothing to settle yet - add some entries first.');
  }

  const closedAt = new Date();
  const amount = toRupees(computation.amount).toFixed(2);

  const settlement = await settlementsRepo.create(
    {
      groupId,
      sessionId: active.id,
      seq: active.seq,
      startedAt: active.startedAt,
      closedAt,
      totalReceived: toRupees(computation.totalReceived).toFixed(2),
      totalExpense: toRupees(computation.totalExpense).toFixed(2),
      totalProfit: toRupees(computation.totalProfit).toFixed(2),
      sharePerPartner: toRupees(computation.sharePerPartner).toFixed(2),
      fromUserId: computation.from?.userId ?? null,
      fromUserName: computation.from?.name ?? '',
      toUserId: computation.to?.userId ?? null,
      toUserName: computation.to?.name ?? '',
      amount,
      // Recorded now so a later amendment can always say what the figure started at.
      originalAmount: amount,
      summary: summary as unknown as Prisma.InputJsonValue,
      createdById: actor.id,
    },
    tx,
  );

  await ledgerSessionsRepo.close(active.id, actor.id, closedAt, tx);
  const next = await ledgerSessionsRepo.create({ groupId, seq: active.seq + 1 }, tx);

  await auditLogsRepo.create(
    {
      groupId,
      sessionId: active.id,
      userId: actor.id,
      userName: actor.name,
      action: 'session.settled',
      entityId: settlement.id,
      details: {
        closedSessionSeq: active.seq,
        newSessionSeq: next.seq,
        amount: toRupees(computation.amount),
        from: computation.from?.name ?? null,
        to: computation.to?.name ?? null,
      },
    },
    tx,
  );

  return { settlement, next };
}

/// Records that the money actually changed hands.
///
/// Kept here beside the other two so the direct path (a one-person partnership) and the
/// approved path run identical code, including the audit entry.
export async function markSettlementPaid(
  groupId: string,
  settlementId: string,
  actor: Actor,
  tx: DbClient,
): Promise<LedgerSettlement> {
  const settlement = await settlementsRepo.findByIdAndGroup(settlementId, groupId, tx);
  if (!settlement) throw new HttpError(404, 'Settlement not found');
  if (settlement.paidAt) throw new HttpError(409, 'This settlement is already marked as paid.');

  const updated = await settlementsRepo.setPaid(
    settlement.id,
    { paidAt: new Date(), paidById: actor.id },
    tx,
  );
  await auditLogsRepo.create(
    {
      groupId,
      sessionId: settlement.sessionId,
      userId: actor.id,
      userName: actor.name,
      action: 'settlement.marked_paid',
      entityId: settlement.id,
      details: {
        amount: settlement.amount.toFixed(2),
        from: settlement.fromUserName,
        to: settlement.toUserName,
      },
    },
    tx,
  );
  return updated;
}

/// Adds an entry to an already-settled session and restamps the settlement from scratch.
///
/// The recomputation is the point. Writing a transaction into a closed session without
/// redoing the arithmetic would leave the stored settlement quietly disagreeing with the
/// entries it claims to summarise - the one thing a financial archive must never do.
export async function amendSettlement(
  groupId: string,
  groupCode: string,
  settlementId: string,
  entry: AmendEntry,
  actor: Actor,
  tx: DbClient,
): Promise<LedgerSettlement> {
  const settlement = await settlementsRepo.findByIdAndGroup(settlementId, groupId, tx);
  if (!settlement) throw new HttpError(404, 'Settlement not found');

  const session = await ledgerSessionsRepo.findByIdAndGroup(settlement.sessionId, groupId, tx);
  if (!session) throw new HttpError(404, 'The session behind this settlement is missing');

  await transactionsRepo.create(
    {
      groupId,
      sessionId: session.id,
      ownerId: entry.ownerId,
      createdById: actor.id,
      type: entry.type,
      category: entry.category,
      amount: entry.amount,
      date: entry.date,
      notes: entry.notes,
    },
    tx,
  );

  const { computation, summary } = await buildSummary(groupId, session, groupCode, actor.name, tx);
  const before = {
    totalProfit: settlement.totalProfit.toFixed(2),
    amount: settlement.amount.toFixed(2),
    from: settlement.fromUserName,
    to: settlement.toUserName,
  };

  const updated = await settlementsRepo.restamp(
    settlement.id,
    {
      totalReceived: toRupees(computation.totalReceived).toFixed(2),
      totalExpense: toRupees(computation.totalExpense).toFixed(2),
      totalProfit: toRupees(computation.totalProfit).toFixed(2),
      sharePerPartner: toRupees(computation.sharePerPartner).toFixed(2),
      fromUserId: computation.from?.userId ?? null,
      fromUserName: computation.from?.name ?? '',
      toUserId: computation.to?.userId ?? null,
      toUserName: computation.to?.name ?? '',
      amount: toRupees(computation.amount).toFixed(2),
      summary: summary as unknown as Prisma.InputJsonValue,
      amendedAt: new Date(),
      amendmentCount: settlement.amendmentCount + 1,
      // First amendment fixes the "was" figure; later ones leave it alone, so it always
      // means "what this settlement said when both partners agreed to it".
      originalAmount: settlement.originalAmount ?? settlement.amount,
    },
    tx,
  );

  await auditLogsRepo.create(
    {
      groupId,
      sessionId: session.id,
      userId: actor.id,
      userName: actor.name,
      action: 'settlement.amended',
      entityId: settlement.id,
      details: {
        added: {
          type: entry.type,
          category: entry.category,
          amount: entry.amount,
          date: entry.date.toISOString().slice(0, 10),
          ownerId: entry.ownerId,
        },
        before,
        after: {
          totalProfit: toRupees(computation.totalProfit).toFixed(2),
          amount: toRupees(computation.amount).toFixed(2),
          from: computation.from?.name ?? '',
          to: computation.to?.name ?? '',
        },
      },
    },
    tx,
  );

  return updated;
}
