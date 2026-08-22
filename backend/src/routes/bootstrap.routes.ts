import { Router } from 'express';
import * as membersRepo from '../db/repositories/members.repository.js';
import * as approvalsRepo from '../db/repositories/approvals.repository.js';
import * as ledgerSessionsRepo from '../db/repositories/ledgerSessions.repository.js';
import * as transactionsRepo from '../db/repositories/transactions.repository.js';
import { computeSettlement } from '../services/money.js';
import {
  serializeGroup,
  serializePartner,
  serializeSession,
  serializeApproval,
  serializeSettlementComputation,
  serializeTransaction,
  serializeUser,
} from '../services/serializers.js';
import { auth } from '../middleware/auth.js';

export const bootstrapRouter = Router();

/// Everything the app needs to render, in one request.
///
/// The frontend used to assemble this from /account/me + /transactions/overview +
/// /transactions. Those three endpoints overlap almost completely - each one re-authenticated
/// and re-read the same partners and the same session - so three round trips to a database in
/// another region were being spent on what is really one question: "what does this
/// partnership look like right now?". Asking it once cuts the app's main refresh from about
/// two seconds to one, and every save and delete goes through this path.
///
/// The individual endpoints still exist; they are a fine API surface and the tests use them.
/// This is simply the one the app itself calls.
bootstrapRouter.get('/', async (req, res, next) => {
  try {
    const { user, group, groupId, member } = auth(req);

    // The session must be resolved before transactions can be read against it, but partners
    // are independent - so the two chains overlap rather than queue up.
    const [members, session, pending] = await Promise.all([
      membersRepo.listByGroup(groupId),
      ledgerSessionsRepo.ensureActive(groupId),
      // Carried in the main refresh so a request from the other partner surfaces on Home the
      // moment it arrives, without the app having to poll a second endpoint for it.
      approvalsRepo.findPending(groupId),
    ]);
    const rows = await transactionsRepo.listLive(groupId, session.id);

    const names = new Map(members.map((m) => [m.userId, m.user.name]));
    const computation = computeSettlement(
      members.map((m) => ({ userId: m.userId, name: m.user.name })),
      rows,
    );

    res.json({
      user: serializeUser(user, group),
      group: serializeGroup(group),
      role: member.role,
      partners: members.map(serializePartner),
      session: serializeSession(session),
      overview: {
        session: serializeSession(session),
        ...serializeSettlementComputation(computation),
        transactionCount: rows.length,
      },
      transactions: rows.map((row) => serializeTransaction(row, names)),
      pendingApproval: pending ? serializeApproval(pending, names, user.id) : null,
    });
  } catch (err) {
    next(err);
  }
});
