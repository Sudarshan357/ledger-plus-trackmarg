import type { LedgerAuditLog, Prisma } from '@prisma/client';
import { prisma, type DbClient } from '../prisma.js';

/// Append-only by convention and by API surface: there is no update or delete here, on
/// purpose. The audit trail is what makes a permanently-deleted transaction still traceable.
export function create(
  data: {
    groupId: string;
    sessionId?: string | null;
    userId: string;
    userName: string;
    action: string;
    entityId?: string | null;
    details?: Prisma.InputJsonValue;
  },
  client: DbClient = prisma,
): Promise<LedgerAuditLog> {
  return client.ledgerAuditLog.create({ data });
}

export function listByGroup(
  groupId: string,
  limit = 200,
  client: DbClient = prisma,
): Promise<LedgerAuditLog[]> {
  return client.ledgerAuditLog.findMany({
    where: { groupId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
