// The only place PrismaClient is constructed. Repository modules import this singleton;
// nothing outside backend/src/db should import PrismaClient directly.
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from '../env.js';

// Prisma 7 needs a driver adapter for Postgres. `databaseUrl` is Supabase's POOLED string
// (port 6543), which is the right one for runtime traffic; DDL goes through DIRECT_URL and
// never touches this client.
//
// The pool is capped explicitly. Supabase's connection ceiling is shared with the Trackmarg
// transport app against the same database, so Ledger+ deliberately keeps a small budget here
// rather than letting a traffic spike starve the other app. connectionTimeoutMillis makes a
// checkout fail fast instead of hanging forever when the pooler is unhealthy.
const adapter = new PrismaPg({
  connectionString: config.databaseUrl,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

export const prisma = new PrismaClient({ adapter });

/// Options for the multi-step interactive transactions (closing a session, amending a
/// settlement, approving either).
///
/// Prisma's defaults are 2s to acquire and 5s to run. Those are generous against a local
/// database and far too tight against this one: Supabase is in ap-northeast-2, every round
/// trip costs 150-200ms, and closing a session takes about eleven of them inside a single
/// transaction - plus a `SELECT … FOR UPDATE` that may be waiting on the other partner's
/// device. That lands close enough to 5s that it intermittently aborted with P2028 and
/// surfaced as a 500 on approval. Raised deliberately rather than by trimming the queries,
/// because every one of them belongs inside the transaction.
export const LONG_TX = { timeout: 20_000, maxWait: 10_000 };

// Every repository function takes this as its client parameter (defaulting to the singleton)
// instead of importing `prisma` directly - that is what lets a route compose several
// repository calls into one atomic unit via prisma.$transaction(async (tx) => ...) and pass
// `tx` through, while the same function still works standalone outside a transaction.
export type DbClient = PrismaClient | Prisma.TransactionClient;
