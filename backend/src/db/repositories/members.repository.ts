import type { LedgerMember, User } from '@prisma/client';
import { prisma, type DbClient } from '../prisma.js';

export type MemberWithUser = LedgerMember & { user: User };

/// Ordered by joinedAt so "Partner A" and "Partner B" mean the same two people everywhere in
/// the app - the settlement direction, the partner cards and the reports all iterate this
/// list, and an unstable order would silently reorder the settlement result.
export function listByGroup(groupId: string, client: DbClient = prisma): Promise<MemberWithUser[]> {
  return client.ledgerMember.findMany({
    where: { groupId },
    include: { user: true },
    orderBy: { joinedAt: 'asc' },
  });
}

export function findByUserId(userId: string, client: DbClient = prisma): Promise<MemberWithUser | null> {
  return client.ledgerMember.findUnique({ where: { userId }, include: { user: true } });
}

export function countByGroup(groupId: string, client: DbClient = prisma): Promise<number> {
  return client.ledgerMember.count({ where: { groupId } });
}

/// Confirms a user is a partner in THIS partnership, and hands back their name for display.
/// Scoped by groupId, so an id belonging to another group's partner cannot resolve - which is
/// what stops "record on behalf of" from becoming a way to write into someone else's books.
export function findInGroup(
  groupId: string,
  userId: string,
  client: DbClient = prisma,
): Promise<MemberWithUser | null> {
  return client.ledgerMember.findFirst({ where: { groupId, userId }, include: { user: true } });
}

export function create(
  data: { groupId: string; userId: string; role: 'owner' | 'partner' },
  client: DbClient = prisma,
): Promise<LedgerMember> {
  return client.ledgerMember.create({ data });
}
