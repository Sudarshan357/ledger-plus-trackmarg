// Read paths shared by several routes. Home, the Record Settle screen and the settlement
// that gets frozen on "Start Fresh Session" must all agree to the paisa, so they all come
// through here rather than each assembling their own query.
import type { LedgerSession } from '@prisma/client';
import { prisma, type DbClient } from '../db/prisma.js';
import * as membersRepo from '../db/repositories/members.repository.js';
import * as ledgerSessionsRepo from '../db/repositories/ledgerSessions.repository.js';
import * as transactionsRepo from '../db/repositories/transactions.repository.js';
import { computeSettlement, type PartnerRef, type SettlementComputation } from './money.js';
import { HttpError } from '../middleware/errorHandler.js';

export interface SessionSnapshot {
  session: LedgerSession;
  partners: PartnerRef[];
  /// userId -> display name, for serializing owner/creator/deleter names without an extra
  /// query per transaction.
  names: Map<string, string>;
  computation: SettlementComputation;
}

export async function loadPartners(
  groupId: string,
  client: DbClient = prisma,
): Promise<{ partners: PartnerRef[]; names: Map<string, string> }> {
  const members = await membersRepo.listByGroup(groupId, client);
  return {
    partners: members.map((m) => ({ userId: m.userId, name: m.user.name })),
    names: new Map(members.map((m) => [m.userId, m.user.name])),
  };
}

/// The active session plus everything computed from it. Throws rather than returning null:
/// a partnership without a live session is a broken invariant, not an empty state, and
/// ensureActive() runs at both signup and login specifically to keep it from happening.
export async function loadActiveSnapshot(
  groupId: string,
  client: DbClient = prisma,
): Promise<SessionSnapshot> {
  const session = await ledgerSessionsRepo.findActive(groupId, client);
  if (!session) throw new HttpError(500, 'This partnership has no active session');
  return loadSnapshotFor(session, groupId, client);
}

export async function loadSnapshotFor(
  session: LedgerSession,
  groupId: string,
  client: DbClient = prisma,
): Promise<SessionSnapshot> {
  const { partners, names } = await loadPartners(groupId, client);
  const transactions = await transactionsRepo.listLive(groupId, session.id, client);
  return {
    session,
    partners,
    names,
    computation: computeSettlement(partners, transactions),
  };
}
