// Bridges Prisma rows to the JSON shape the frontend consumes: Decimal becomes a plain
// number of rupees, Date becomes ISO-8601, and internal columns the UI has no business
// knowing about (passwordHash above all) never leave this file.
import type {
  Group,
  LedgerApproval,
  LedgerMember,
  LedgerSession,
  LedgerSettlement,
  LedgerTransaction,
  User,
  Prisma,
} from '@prisma/client';
import { formatGroupCode, initialsOf } from './codes.js';
import { toRupees, toPaise, type PartnerTotals, type SettlementComputation } from './money.js';

function dec(value: Prisma.Decimal | number): number {
  return toRupees(toPaise(value));
}

/// A DATE column has no time or zone; toISOString() would shift it across a day boundary for
/// anyone east or west of UTC. The date a partner picked is the date they see back.
function dateOnly(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(
    value.getUTCDate(),
  ).padStart(2, '0')}`;
}

export function serializeGroup(group: Group) {
  return {
    id: group.id,
    code: group.code,
    displayCode: formatGroupCode(group.code),
    name: group.name,
    frozen: group.frozen,
    createdAt: group.createdAt.toISOString(),
  };
}

export function serializePartner(member: LedgerMember & { user: User }) {
  return {
    userId: member.userId,
    name: member.user.name,
    phone: member.user.phone,
    initials: initialsOf(member.user.name),
    partnerCode: member.user.userCode ?? '',
    role: member.role,
    joinedAt: member.joinedAt.toISOString(),
  };
}

export function serializeUser(user: User, group: Group) {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    initials: initialsOf(user.name),
    partnerCode: user.userCode ?? '',
    groupId: user.groupId,
    groupCode: group.code,
    displayGroupCode: formatGroupCode(group.code),
  };
}

export function serializeSession(session: LedgerSession) {
  return {
    id: session.id,
    seq: session.seq,
    status: session.status,
    startedAt: session.startedAt.toISOString(),
    closedAt: session.closedAt ? session.closedAt.toISOString() : null,
  };
}

/// `ownerName` is denormalized in at read time rather than stored on the row: the ledger card
/// needs a name, but the transaction's source of truth is the ownerId, and a partner who
/// changes their name should not leave old entries showing the old one.
export function serializeTransaction(
  txn: LedgerTransaction,
  names: Map<string, string>,
) {
  return {
    id: txn.id,
    sessionId: txn.sessionId,
    ownerId: txn.ownerId,
    ownerName: names.get(txn.ownerId) ?? 'Former partner',
    ownerInitials: initialsOf(names.get(txn.ownerId) ?? '?'),
    type: txn.type as 'received' | 'expense',
    category: txn.category,
    amount: dec(txn.amount),
    date: dateOnly(txn.date),
    notes: txn.notes,
    createdById: txn.createdById,
    createdByName: names.get(txn.createdById) ?? 'Former partner',
    /// True when one partner recorded this for the other. The UI surfaces it as
    /// "recorded by X" so an entry on your side of the books always says who put it there.
    recordedOnBehalf: txn.createdById !== txn.ownerId,
    createdAt: txn.createdAt.toISOString(),
    updatedAt: txn.updatedAt.toISOString(),
    deletedById: txn.deletedById,
    deletedByName: txn.deletedById ? names.get(txn.deletedById) ?? 'Former partner' : null,
    deletedAt: txn.deletedAt ? txn.deletedAt.toISOString() : null,
  };
}

export function serializePartnerTotals(totals: PartnerTotals) {
  return {
    userId: totals.userId,
    name: totals.name,
    initials: initialsOf(totals.name),
    received: toRupees(totals.received),
    expense: toRupees(totals.expense),
    net: toRupees(totals.net),
    shareBalance: toRupees(totals.shareBalance),
  };
}

export function serializeSettlementComputation(result: SettlementComputation) {
  return {
    partners: result.partners.map(serializePartnerTotals),
    totalReceived: toRupees(result.totalReceived),
    totalExpense: toRupees(result.totalExpense),
    totalProfit: toRupees(result.totalProfit),
    sharePerPartner: toRupees(result.sharePerPartner),
    from: result.from,
    to: result.to,
    amount: toRupees(result.amount),
  };
}

export function serializeSettlement(settlement: LedgerSettlement) {
  return {
    id: settlement.id,
    sessionId: settlement.sessionId,
    seq: settlement.seq,
    /// "Settlement #001"
    label: `Settlement #${String(settlement.seq).padStart(3, '0')}`,
    startedAt: settlement.startedAt.toISOString(),
    closedAt: settlement.closedAt.toISOString(),
    totalReceived: dec(settlement.totalReceived),
    totalExpense: dec(settlement.totalExpense),
    totalProfit: dec(settlement.totalProfit),
    sharePerPartner: dec(settlement.sharePerPartner),
    fromUserId: settlement.fromUserId,
    fromUserName: settlement.fromUserName,
    toUserId: settlement.toUserId,
    toUserName: settlement.toUserName,
    amount: dec(settlement.amount),
    summary: settlement.summary,
    /// Whether the money actually moved, as opposed to merely having been calculated.
    paid: settlement.paidAt !== null,
    paidAt: settlement.paidAt ? settlement.paidAt.toISOString() : null,
    paidById: settlement.paidById,
    amended: settlement.amendmentCount > 0,
    amendmentCount: settlement.amendmentCount,
    amendedAt: settlement.amendedAt ? settlement.amendedAt.toISOString() : null,
    originalAmount: settlement.originalAmount === null ? null : dec(settlement.originalAmount),
    createdAt: settlement.createdAt.toISOString(),
  };
}

/// A change waiting on the other partner. `isMine` is resolved server-side so the UI never
/// has to work out whether to offer Approve/Reject or Withdraw.
export function serializeApproval(
  approval: LedgerApproval,
  names: Map<string, string>,
  viewerId: string,
) {
  return {
    id: approval.id,
    kind: approval.kind as 'close_session' | 'amend_settlement' | 'mark_paid' | 'edit_transaction',
    status: approval.status,
    requestedById: approval.requestedById,
    requestedByName: names.get(approval.requestedById) ?? 'Former partner',
    requestedAt: approval.requestedAt.toISOString(),
    settlementId: approval.settlementId,
    sessionId: approval.sessionId,
    transactionId: approval.transactionId,
    payload: approval.payload,
    isMine: approval.requestedById === viewerId,
  };
}
