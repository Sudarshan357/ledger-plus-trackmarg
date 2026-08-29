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

/// Prisma's defaults are 2s to acquire a connection and 5s to run the transaction. Those are
/// generous against a local database and far too tight against this one: Supabase is in
/// ap-northeast-2, every round trip costs 150-800ms, and the multi-step transactions here
/// (registering a partnership, closing a session, amending a settlement) each make eight to
/// eleven of them - plus, in some, a `SELECT … FOR UPDATE` that may be waiting on the other
/// partner's device.
///
/// Both of those aborted intermittently with P2028 and surfaced as a 500. Raised rather than
/// solved by trimming queries, because every one of them belongs inside its transaction.
const LONG_TX = { timeout: 20_000, maxWait: 10_000 };

/// Use this for every interactive transaction instead of `prisma.$transaction` directly.
///
/// The timeout was originally passed per call site, and the call site that mattered most -
/// registration, the longest chain in the app - was the one that never got it. A helper that
/// applies it by construction is the only version of this fix that stays fixed.
export function transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, LONG_TX);
}

// Every repository function takes this as its client parameter (defaulting to the singleton)
// instead of importing `prisma` directly - that is what lets a route compose several
// repository calls into one atomic unit via prisma.$transaction(async (tx) => ...) and pass
// `tx` through, while the same function still works standalone outside a transaction.
export type DbClient = PrismaClient | Prisma.TransactionClient;
