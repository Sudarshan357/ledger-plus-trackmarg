import { Router } from 'express';
import * as transactionsRepo from '../db/repositories/transactions.repository.js';
import * as ledgerSessionsRepo from '../db/repositories/ledgerSessions.repository.js';
import * as settlementsRepo from '../db/repositories/settlements.repository.js';
import * as membersRepo from '../db/repositories/members.repository.js';
import {
  serializeGroup,
  serializePartner,
  serializeSession,
  serializeSettlement,
  serializeSettlementComputation,
  serializeTransaction,
} from '../services/serializers.js';
import { loadActiveSnapshot, loadPartners } from '../services/ledgerQueries.js';
import { auth } from '../middleware/auth.js';

export const exportRouter = Router();

/// One call that returns everything both exports need. PDF and CSV are rendered on the device
/// (no server-side document generation), but the DATA they render must be the server's - an
/// export assembled from whatever the screen happened to have cached could disagree with the
/// ledger it claims to represent.
exportRouter.get('/', async (req, res, next) => {
  try {
    const { group, groupId } = auth(req);
    const [{ names }, members, sessions, settlements, allRows, active] = await Promise.all([
      loadPartners(groupId),
      membersRepo.listByGroup(groupId),
      ledgerSessionsRepo.listByGroup(groupId),
      settlementsRepo.listByGroup(groupId),
      transactionsRepo.listLiveByGroup(groupId),
      loadActiveSnapshot(groupId),
    ]);

    const sessionSeq = new Map(sessions.map((s) => [s.id, s.seq]));

    res.json({
      group: serializeGroup(group),
      partners: members.map(serializePartner),
      currentSession: serializeSession(active.session),
      current: serializeSettlementComputation(active.computation),
      sessions: sessions.map(serializeSession),
      settlements: settlements.map(serializeSettlement),
      transactions: allRows.map((row) => ({
        ...serializeTransaction(row, names),
        sessionSeq: sessionSeq.get(row.sessionId) ?? null,
      })),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});
