import type { User, Group, LedgerMember } from '@prisma/client';
import { prisma, type DbClient } from '../prisma.js';

export type UserWithGroup = User & { group: Group; ledgerMember: LedgerMember | null };

export function findByGroupAndPhone(
  groupId: string,
  phone: string,
  client: DbClient = prisma,
): Promise<User | null> {
  return client.user.findFirst({ where: { groupId, phone } });
}

/// Every lookup that authorizes a request goes through a groupId-scoped query. Looking a user
/// up by id alone would work too, but scoping it here means a token whose groupId claim no
/// longer matches the user's group simply fails to resolve.
/// Pulls the group AND the Ledger+ membership in the same query. Both are needed on every
/// authenticated request, and the database is a long way away (Supabase, ap-northeast-2) -
/// fetching them separately spent an extra round trip per request for no reason.
export function findActiveByIdAndGroup(
  id: string,
  groupId: string,
  client: DbClient = prisma,
): Promise<UserWithGroup | null> {
  return client.user.findFirst({
    where: { id, groupId, active: true },
    include: { group: true, ledgerMember: true },
  });
}

export function findActiveByGroupAndPhone(
  groupId: string,
  phone: string,
  client: DbClient = prisma,
): Promise<User | null> {
  return client.user.findFirst({ where: { groupId, phone, active: true } });
}

export async function existsByUserCode(code: string, client: DbClient = prisma): Promise<boolean> {
  return (await client.user.count({ where: { userCode: code } })) > 0;
}

export function create(
  data: {
    groupId: string;
    name: string;
    phone: string;
    userCode: string;
    passwordHash: string;
  },
  client: DbClient = prisma,
): Promise<User> {
  // role: 'admin' for every Ledger+ partner. The shared Trackmarg Role enum only has
  // admin/driver, and in a two-person partnership neither partner is subordinate to the
  // other - equal peers is the accurate mapping, and it avoids altering an enum the transport
  // app depends on.
  return client.user.create({ data: { ...data, role: 'admin' } });
}

export function updatePasswordHash(
  id: string,
  passwordHash: string,
  client: DbClient = prisma,
): Promise<User> {
  return client.user.update({ where: { id }, data: { passwordHash } });
}

export function updateProfile(
  id: string,
  data: { name?: string; phone?: string },
  client: DbClient = prisma,
): Promise<User> {
  return client.user.update({ where: { id }, data });
}
