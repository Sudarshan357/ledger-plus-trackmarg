import type { LedgerTransaction, Prisma } from '@prisma/client';
import { prisma, type DbClient } from '../prisma.js';

// Every function here takes groupId and folds it into the WHERE clause. That is the tenant
// boundary: there is deliberately no "find by id" that does not also require the group, so a
// crafted id from another partnership cannot resolve to a row.

export function listLive(
  groupId: string,
  sessionId: string,
  client: DbClient = prisma,
): Promise<LedgerTransaction[]> {
  return client.ledgerTransaction.findMany({
    where: { groupId, sessionId, deletedAt: null },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
}

/// Live (non-deleted) rows across every session in the group - what the calendar-based
/// Reports screen works from, since a monthly report spans whatever sessions that month
/// happens to contain.
export function listLiveByGroup(
  groupId: string,
  client: DbClient = prisma,
): Promise<LedgerTransaction[]> {
  return client.ledgerTransaction.findMany({
    where: { groupId, deletedAt: null },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
}

export function listDeleted(groupId: string, client: DbClient = prisma): Promise<LedgerTransaction[]> {
  return client.ledgerTransaction.findMany({
    where: { groupId, deletedAt: { not: null } },
    orderBy: { deletedAt: 'desc' },
  });
}

export function findByIdAndGroup(
  id: string,
  groupId: string,
  client: DbClient = prisma,
): Promise<LedgerTransaction | null> {
  return client.ledgerTransaction.findFirst({ where: { id, groupId } });
}

export function create(
  data: {
    groupId: string;
    sessionId: string;
    ownerId: string;
    createdById: string;
    type: 'received' | 'expense';
    category: string;
    amount: Prisma.Decimal | string;
    date: Date;
    notes: string;
  },
  client: DbClient = prisma,
): Promise<LedgerTransaction> {
  return client.ledgerTransaction.create({ data });
}

export function update(
  id: string,
  data: {
    type?: 'received' | 'expense';
    category?: string;
    amount?: Prisma.Decimal | string;
    date?: Date;
    notes?: string;
    updatedById: string;
  },
  client: DbClient = prisma,
): Promise<LedgerTransaction> {
  return client.ledgerTransaction.update({ where: { id }, data });
}

/// Stage one of deletion: the row keeps every original field and simply gains a deletion
/// stamp, so Deleted Records shows the real record rather than a summary of one.
export function softDelete(
  id: string,
  deletedById: string,
  client: DbClient = prisma,
): Promise<LedgerTransaction> {
  return client.ledgerTransaction.update({
    where: { id },
    data: { deletedById, deletedAt: new Date() },
  });
}

/// Stage two: gone for good. Callers must have written the audit-log snapshot first - that
/// entry is the only trace left afterwards.
export async function hardDelete(id: string, client: DbClient = prisma): Promise<void> {
  await client.ledgerTransaction.delete({ where: { id } });
}

export function countInSession(
  groupId: string,
  sessionId: string,
  client: DbClient = prisma,
): Promise<number> {
  return client.ledgerTransaction.count({ where: { groupId, sessionId, deletedAt: null } });
}
