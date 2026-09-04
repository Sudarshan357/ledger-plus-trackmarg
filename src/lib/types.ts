// The JSON contract, exactly as backend/src/services/serializers.ts produces it.

export type TxnType = 'received' | 'expense';

export interface Me {
  user: {
    id: string;
    name: string;
    phone: string;
    initials: string;
    partnerCode: string;
    groupId: string;
    groupCode: string;
    displayGroupCode: string;
  };
  group: {
    id: string;
    code: string;
    displayCode: string;
    name: string;
    frozen: boolean;
    createdAt: string;
  };
  role: string;
  partners: Partner[];
  session: SessionInfo;
}

export interface Partner {
  userId: string;
  name: string;
  phone: string;
  initials: string;
  partnerCode: string;
  role: string;
  joinedAt: string;
}

export interface SessionInfo {
  id: string;
  seq: number;
  status: string;
  startedAt: string;
  closedAt: string | null;
}

export interface Transaction {
  id: string;
  sessionId: string;
  ownerId: string;
  ownerName: string;
  ownerInitials: string;
  type: TxnType;
  category: string;
  amount: number;
  date: string;
  notes: string;
  createdById: string;
  createdByName: string;
  /// One partner recorded this for the other.
  recordedOnBehalf: boolean;
  createdAt: string;
  updatedAt: string;
  deletedById: string | null;
  deletedByName: string | null;
  deletedAt: string | null;
}

export interface DeletedRecord extends Transaction {
  sessionSeq: number | null;
  sessionLabel: string;
  canPermanentlyDelete: boolean;
  status: string;
}

export interface PartnerTotals {
  userId: string;
  name: string;
  initials: string;
  received: number;
  expense: number;
  net: number;
  shareBalance: number;
}

export interface SettlementView {
  partners: PartnerTotals[];
  totalReceived: number;
  totalExpense: number;
  totalProfit: number;
  sharePerPartner: number;
  from: { userId: string; name: string } | null;
  to: { userId: string; name: string } | null;
  amount: number;
}

export interface Overview extends SettlementView {
  session: SessionInfo;
  transactionCount: number;
}

export interface SettlementSummary {
  partners: Array<{
    userId: string;
    name: string;
    received: number;
    expense: number;
    net: number;
    shareBalance: number;
  }>;
  transactions: Transaction[];
  transactionCount: number;
  groupCode: string;
  closedByName: string;
}

export interface Settlement {
  id: string;
  sessionId: string;
  seq: number;
  label: string;
  startedAt: string;
  closedAt: string;
  totalReceived: number;
  totalExpense: number;
  totalProfit: number;
  sharePerPartner: number;
  fromUserId: string | null;
  fromUserName: string;
  toUserId: string | null;
  toUserName: string;
  amount: number;
  summary: SettlementSummary;
  /// Whether the money actually moved, as opposed to merely having been calculated.
  paid: boolean;
  paidAt: string | null;
  paidById: string | null;
  amended: boolean;
  amendmentCount: number;
  amendedAt: string | null;
  originalAmount: number | null;
  createdAt: string;
}

/// One side of an edit_transaction approval's payload - what an entry looked like before, or
/// what it is being changed to.
export interface EditSnapshot {
  type: TxnType;
  category: string;
  amount: string;
  date: string;
  notes: string;
}

/// A change waiting on the other partner: closing the live session, adding an entry to an
/// already-settled one, confirming a payment, or editing an entry more than 10 minutes old.
export interface PendingApproval {
  id: string;
  kind: 'close_session' | 'amend_settlement' | 'mark_paid' | 'edit_transaction';
  status: string;
  requestedById: string;
  requestedByName: string;
  requestedAt: string;
  settlementId: string | null;
  sessionId: string | null;
  transactionId: string | null;
  payload: {
    sessionSeq?: number;
    transactionCount?: number;
    settlementLabel?: string;
    fromUserName?: string;
    toUserName?: string;
    type?: TxnType;
    category?: string;
    amount?: string;
    date?: string;
    notes?: string;
    ownerId?: string;
    proposed?: EditSnapshot;
    original?: EditSnapshot;
  };
  /// Resolved server-side, so the UI never has to work out whether to offer
  /// Approve/Reject or Withdraw.
  isMine: boolean;
}

export interface ReportView {
  mode: 'monthly' | 'yearly';
  period: string;
  label: string;
  received: number;
  expense: number;
  profit: number;
  transactionCount: number;
  byCategory: Array<{ category: string; amount: number }>;
  perPartner: PartnerTotals[];
}

export interface ExportBundle {
  group: Me['group'];
  partners: Partner[];
  currentSession: SessionInfo;
  current: SettlementView;
  sessions: SessionInfo[];
  settlements: Settlement[];
  transactions: Array<Transaction & { sessionSeq: number | null }>;
  generatedAt: string;
}
