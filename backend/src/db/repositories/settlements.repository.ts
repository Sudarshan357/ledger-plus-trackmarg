import type { LedgerSettlement, Prisma } from '@prisma/client';
import { prisma, type DbClient } from '../prisma.js';

export function listByGroup(groupId: string, client: DbClient = prisma): Promise<LedgerSettlement[]> {
  return client.ledgerSettlement.findMany({ where: { groupId }, orderBy: { seq: 'desc' } });
}

export function findByIdAndGroup(
  id: string,
  groupId: string,
  client: DbClient = prisma,
): Promise<LedgerSettlement | null> {
  return client.ledgerSettlement.findFirst({ where: { id, groupId } });
}

export function create(
  data: {
    groupId: string;
    sessionId: string;
    seq: number;
    startedAt: Date;
    closedAt: Date;
    totalReceived: string;
    totalExpense: string;
    totalProfit: string;
    sharePerPartner: string;
    fromUserId: string | null;
    fromUserName: string;
    toUserId: string | null;
    toUserName: string;
    amount: string;
    originalAmount: string;
    summary: Prisma.InputJsonValue;
    createdById: string;
  },
  client: DbClient = prisma,
): Promise<LedgerSettlement> {
  return client.ledgerSettlement.create({ data });
}

/// Rewrites a settlement's computed figures after an amendment. Every derived field is
/// replaced together, so a settlement can never end up half-recomputed.
export function restamp(
  id: string,
  data: {
    totalReceived: string;
    totalExpense: string;
    totalProfit: string;
    sharePerPartner: string;
    fromUserId: string | null;
    fromUserName: string;
    toUserId: string | null;
    toUserName: string;
    amount: string;
    summary: Prisma.InputJsonValue;
    amendedAt: Date;
    amendmentCount: number;
    originalAmount: Prisma.Decimal | string;
  },
  client: DbClient = prisma,
): Promise<LedgerSettlement> {
  return client.ledgerSettlement.update({ where: { id }, data });
}

export function setPaid(
  id: string,
  paid: { paidAt: Date; paidById: string } | null,
  client: DbClient = prisma,
): Promise<LedgerSettlement> {
  return client.ledgerSettlement.update({
    where: { id },
    data: paid ?? { paidAt: null, paidById: null },
  });
}
