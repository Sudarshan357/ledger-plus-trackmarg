import type { LedgerSession } from '@prisma/client';
import { prisma, type DbClient } from '../prisma.js';

export function findActive(groupId: string, client: DbClient = prisma): Promise<LedgerSession | null> {
  return client.ledgerSession.findFirst({ where: { groupId, status: 'active' } });
}

export function findByIdAndGroup(
  id: string,
  groupId: string,
  client: DbClient = prisma,
): Promise<LedgerSession | null> {
  return client.ledgerSession.findFirst({ where: { id, groupId } });
}

export function listByGroup(groupId: string, client: DbClient = prisma): Promise<LedgerSession[]> {
  return client.ledgerSession.findMany({ where: { groupId }, orderBy: { seq: 'desc' } });
}

export async function nextSeq(groupId: string, client: DbClient = prisma): Promise<number> {
  const latest = await client.ledgerSession.findFirst({
    where: { groupId },
    orderBy: { seq: 'desc' },
    select: { seq: true },
  });
  return (latest?.seq ?? 0) + 1;
}

export function create(
  data: { groupId: string; seq: number },
  client: DbClient = prisma,
): Promise<LedgerSession> {
  return client.ledgerSession.create({ data });
}

export function close(
  id: string,
  closedById: string,
  closedAt: Date,
  client: DbClient = prisma,
): Promise<LedgerSession> {
  return client.ledgerSession.update({
    where: { id },
    data: { status: 'closed', closedAt, closedById },
  });
}

/// Opens the group's first session if it somehow has none. Used on login rather than only at
/// signup, so a partner who joins an existing group always lands in a live session even if
/// the group predates their membership.
export async function ensureActive(groupId: string, client: DbClient = prisma): Promise<LedgerSession> {
  const existing = await findActive(groupId, client);
  if (existing) return existing;
  return create({ groupId, seq: await nextSeq(groupId, client) }, client);
}
