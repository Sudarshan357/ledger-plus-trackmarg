// Applying an edit to an entry. Lives here rather than in a route because it has two callers -
// direct (within the free-edit window, or a single-member partnership with nobody to ask) and
// approved (the other partner agreed to a change requested after that window). Both paths must
// do exactly the same thing, so there is exactly one copy - see settlementActions.ts for the
// same reasoning applied to closing and amending a settlement.
import type { LedgerTransaction } from '@prisma/client';
import type { DbClient } from '../db/prisma.js';
import * as transactionsRepo from '../db/repositories/transactions.repository.js';
import * as auditLogsRepo from '../db/repositories/auditLogs.repository.js';

export interface Actor {
  id: string;
  name: string;
}

export interface TransactionEdit {
  type: 'received' | 'expense';
  category: string;
  amount: string;
  date: Date;
  notes: string;
}

export async function applyTransactionEdit(
  groupId: string,
  existing: LedgerTransaction,
  edit: TransactionEdit,
  actor: Actor,
  tx: DbClient,
): Promise<LedgerTransaction> {
  const row = await transactionsRepo.update(
    existing.id,
    { ...edit, updatedById: actor.id },
    tx,
  );
  await auditLogsRepo.create(
    {
      groupId,
      sessionId: existing.sessionId,
      userId: actor.id,
      userName: actor.name,
      action: 'transaction.updated',
      entityId: row.id,
      details: { type: row.type, category: row.category, amount: row.amount.toFixed(2) },
    },
    tx,
  );
  return row;
}
