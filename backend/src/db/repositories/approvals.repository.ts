import type { LedgerApproval, Prisma } from '@prisma/client';
import { prisma, type DbClient } from '../prisma.js';

export function findPending(groupId: string, client: DbClient = prisma): Promise<LedgerApproval | null> {
  return client.ledgerApproval.findFirst({ where: { groupId, status: 'pending' } });
}

export function findByIdAndGroup(
  id: string,
  groupId: string,
  client: DbClient = prisma,
): Promise<LedgerApproval | null> {
  return client.ledgerApproval.findFirst({ where: { id, groupId } });
}

export function create(
  data: {
    groupId: string;
    kind: 'close_session' | 'amend_settlement' | 'mark_paid';
    requestedById: string;
    payload: Prisma.InputJsonValue;
    sessionId?: string | null;
    settlementId?: string | null;
  },
  client: DbClient = prisma,
): Promise<LedgerApproval> {
  return client.ledgerApproval.create({ data });
}

/// Closes out a request. Guarded on `status: 'pending'` in the WHERE clause rather than
/// checked beforehand, so two simultaneous decisions cannot both land - the second updates
/// zero rows and the caller can tell.
export async function decide(
  id: string,
  status: 'approved' | 'rejected' | 'cancelled',
  decidedById: string,
  client: DbClient = prisma,
): Promise<boolean> {
  const result = await client.ledgerApproval.updateMany({
    where: { id, status: 'pending' },
    data: { status, decidedById, decidedAt: new Date() },
  });
  return result.count === 1;
}
