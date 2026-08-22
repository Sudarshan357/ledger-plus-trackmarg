import type { Session } from '@prisma/client';
import { prisma, type DbClient } from '../prisma.js';

export function create(
  data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
    ip?: string | null;
  },
  client: DbClient = prisma,
): Promise<Session> {
  return client.session.create({ data });
}

/// Active means: exists, not revoked, not expired. All three are checked in the query rather
/// than in JS so a revoked token can never be accepted because of a missed branch.
export function findActiveByTokenHash(
  tokenHash: string,
  client: DbClient = prisma,
): Promise<Session | null> {
  return client.session.findFirst({
    where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
  });
}

export async function revokeByTokenHash(tokenHash: string, client: DbClient = prisma): Promise<void> {
  await client.session.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/// Used by Change PIN: a PIN change should log out every other device, otherwise a session
/// opened with the old PIN would outlive it.
export async function revokeAllForUser(
  userId: string,
  options: { exceptTokenHash?: string } = {},
  client: DbClient = prisma,
): Promise<void> {
  await client.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(options.exceptTokenHash ? { tokenHash: { not: options.exceptTokenHash } } : {}),
    },
    data: { revokedAt: new Date() },
  });
}

export async function touch(tokenHash: string, client: DbClient = prisma): Promise<void> {
  await client.session.updateMany({ where: { tokenHash }, data: { lastSeenAt: new Date() } });
}
