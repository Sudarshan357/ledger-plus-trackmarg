import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { transaction, prisma } from '../db/prisma.js';
import * as transactionsRepo from '../db/repositories/transactions.repository.js';
import * as ledgerSessionsRepo from '../db/repositories/ledgerSessions.repository.js';
import * as settlementsRepo from '../db/repositories/settlements.repository.js';
import * as membersRepo from '../db/repositories/members.repository.js';
import * as auditLogsRepo from '../db/repositories/auditLogs.repository.js';
import { isValidCategory, type TransactionType } from '../services/categories.js';
import {
  serializeGroup,
  serializePartner,
  serializeSession,
  serializeSettlement,
  serializeTransaction,
} from '../services/serializers.js';
import { loadPartners } from '../services/ledgerQueries.js';
import { HttpError } from '../middleware/errorHandler.js';
import { auth } from '../middleware/auth.js';
import { actorOf, broadcast } from '../services/sse.js';

export const backupRouter = Router();

// Backup and restore, following the same contract the Trackmarg transport app uses: a backup
// is a JSON file the user keeps, and a restore is strictly ADDITIVE. Nothing is deleted,
// nothing is overwritten, and a file can be loaded into a different partnership than the one
// it came from. For a two-person ledger a "restore" that wiped and replaced would be a way to
// destroy the other partner's records, which is the opposite of what this app is for.

const FORMAT = 'ledger-plus-backup';
const VERSION = 1;

/// Guardrail on a single import. Large enough for years of a small workshop's books, small
/// enough that a malformed or hostile file cannot tie up the database.
const MAX_ENTRIES = 5000;

// ── BACKUP ──────────────────────────────────────────────────────────────────
backupRouter.get('/', async (req, res, next) => {
  try {
    const { group, groupId } = auth(req);
    const [{ names }, members, sessions, settlements, rows] = await Promise.all([
      loadPartners(groupId),
      membersRepo.listByGroup(groupId),
      ledgerSessionsRepo.listByGroup(groupId),
      settlementsRepo.listByGroup(groupId),
      transactionsRepo.listLiveByGroup(groupId),
    ]);
    const seqOf = new Map(sessions.map((s) => [s.id, s.seq]));

    res.json({
      format: FORMAT,
      version: VERSION,
      generatedAt: new Date().toISOString(),
      group: serializeGroup(group),
      partners: members.map(serializePartner),
      sessions: sessions.map(serializeSession),
      settlements: settlements.map(serializeSettlement),
      transactions: rows.map((row) => ({
        ...serializeTransaction(row, names),
        sessionSeq: seqOf.get(row.sessionId) ?? null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

interface IncomingEntry {
  id?: unknown;
  type?: unknown;
  category?: unknown;
  amount?: unknown;
  date?: unknown;
  notes?: unknown;
  ownerId?: unknown;
  ownerName?: unknown;
}

// ── RESTORE ─────────────────────────────────────────────────────────────────
backupRouter.post('/restore', async (req, res, next) => {
  try {
    const { user, groupId, groupCode } = auth(req);
    const body = req.body ?? {};

    if (body.format !== FORMAT) {
      throw new HttpError(400, 'That does not look like a Ledger+ backup file.');
    }
    const entries: IncomingEntry[] = Array.isArray(body.transactions) ? body.transactions : [];
    if (entries.length === 0) throw new HttpError(400, 'This backup has no entries to restore.');
    if (entries.length > MAX_ENTRIES) {
      throw new HttpError(400, `A backup can restore at most ${MAX_ENTRIES} entries at a time.`);
    }

    const members = await membersRepo.listByGroup(groupId);
    const memberIds = new Set(members.map((m) => m.userId));
    const byName = new Map(members.map((m) => [m.user.name.trim().toLowerCase(), m.userId]));

    // Everything lands in the live session. A restored entry has to belong somewhere that
    // still accepts entries, and dropping rows into a settled session would silently
    // contradict a settlement both partners already agreed to.
    const session = await ledgerSessionsRepo.ensureActive(groupId);

    // Already present, by the id they carried in the file - this is what makes restoring the
    // same backup twice a no-op.
    const existing = new Set(
      (
        await prisma.ledgerTransaction.findMany({
          where: { groupId, sourceId: { not: null } },
          select: { sourceId: true },
        })
      ).map((r) => r.sourceId as string),
    );

    let imported = 0;
    let skipped = 0;
    let reassigned = 0;
    const rejected: string[] = [];

    const prepared: Prisma.LedgerTransactionCreateManyInput[] = [];

    for (const entry of entries) {
      const sourceId = String(entry.id ?? '');
      if (!sourceId) {
        rejected.push('an entry with no id');
        continue;
      }
      if (existing.has(sourceId)) {
        skipped += 1;
        continue;
      }

      const type = entry.type === 'received' || entry.type === 'expense' ? (entry.type as TransactionType) : null;
      const category = String(entry.category ?? '').trim();
      const amount = Number(entry.amount);
      const date = String(entry.date ?? '');

      if (!type || !isValidCategory(type, category) || !Number.isFinite(amount) || amount <= 0
          || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        rejected.push(sourceId);
        continue;
      }

      // Owner resolution, in order: the same partner id, then a partner of the same name (so a
      // backup restored into a rebuilt partnership still lands on the right person), then the
      // person doing the restore. Never a stranger's id from the file.
      let ownerId = String(entry.ownerId ?? '');
      if (!memberIds.has(ownerId)) {
        const named = byName.get(String(entry.ownerName ?? '').trim().toLowerCase());
        ownerId = named ?? user.id;
        reassigned += 1;
      }

      prepared.push({
        groupId,
        sessionId: session.id,
        sourceId,
        ownerId,
        createdById: user.id,
        type,
        category,
        amount: amount.toFixed(2),
        date: new Date(`${date}T00:00:00.000Z`),
        notes: String(entry.notes ?? '').slice(0, 500),
      });
      existing.add(sourceId);
      imported += 1;
    }

    if (prepared.length === 0) {
      return res.json({ imported: 0, skipped, reassigned, rejected: rejected.length });
    }

    await transaction(async (tx) => {
      // skipDuplicates covers the race where the other partner restores the same file at the
      // same moment; the unique (groupId, sourceId) index is the real guarantee.
      await tx.ledgerTransaction.createMany({ data: prepared, skipDuplicates: true });
      await auditLogsRepo.create(
        {
          groupId,
          sessionId: session.id,
          userId: user.id,
          userName: user.name,
          action: 'data.restored',
          entityId: session.id,
          details: {
            imported, skipped, reassigned,
            rejected: rejected.length,
            sourceGroupCode: (body.group as { code?: string } | undefined)?.code ?? null,
            backupGeneratedAt: String(body.generatedAt ?? ''),
          },
        },
        tx,
      );
    });

    broadcast(groupCode, 'ledger-changed', { reason: 'restored', actor: actorOf(req) });
    res.json({ imported, skipped, reassigned, rejected: rejected.length });
  } catch (err) {
    next(err);
  }
});
