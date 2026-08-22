import type { Group } from '@prisma/client';
import { prisma, type DbClient } from '../prisma.js';

/// Group codes are stored normalized (see services/codes.ts). Callers must normalize before
/// calling; this repository never guesses at formatting.
export function findByCode(code: string, client: DbClient = prisma): Promise<Group | null> {
  return client.group.findUnique({ where: { code } });
}

export function findById(id: string, client: DbClient = prisma): Promise<Group | null> {
  return client.group.findUnique({ where: { id } });
}

export async function existsByCode(code: string, client: DbClient = prisma): Promise<boolean> {
  return (await client.group.count({ where: { code } })) > 0;
}

export function create(
  data: { code: string; name: string },
  client: DbClient = prisma,
): Promise<Group> {
  return client.group.create({ data });
}

export function rename(id: string, name: string, client: DbClient = prisma): Promise<Group> {
  return client.group.update({ where: { id }, data: { name } });
}
