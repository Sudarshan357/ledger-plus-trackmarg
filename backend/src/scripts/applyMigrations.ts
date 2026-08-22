// Applies prisma/migrations/*.sql against DIRECT_URL, in filename order, once each.
//
// Ledger+ does NOT use `prisma migrate deploy`. That command records applied migrations in
// public._prisma_migrations, and that table belongs to the Trackmarg transport app's history:
// writing Ledger+ rows into it would make the transport app's own `prisma migrate` report
// migrations it has never heard of. Ledger+ keeps its own ledger in ledger._migrations
// instead, so the two apps' schema histories stay completely independent on the shared
// database.
//
// Run with: npm run db:migrate
import '../env.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Client } from 'pg';
import { config } from '../env.js';

const migrationsDir = path.join(config.projectRoot, 'prisma', 'migrations');

async function main(): Promise<void> {
  const url = config.directUrl || config.databaseUrl;
  if (!url) throw new Error('DIRECT_URL (or DATABASE_URL) must be set to run migrations');

  const files = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('No migration files found.');
    return;
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    // Bootstrap the tracking table. Both statements are idempotent, so a re-run on an
    // already-migrated database is a no-op rather than an error.
    await client.query('CREATE SCHEMA IF NOT EXISTS "ledger"');
    await client.query(`
      CREATE TABLE IF NOT EXISTS "ledger"."_migrations" (
        "name"       TEXT PRIMARY KEY,
        "checksum"   TEXT NOT NULL,
        "appliedAt"  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const applied = new Map<string, string>(
      (await client.query<{ name: string; checksum: string }>(
        'SELECT "name", "checksum" FROM "ledger"."_migrations"',
      )).rows.map((row) => [row.name, row.checksum]),
    );

    for (const name of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, name), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const previous = applied.get(name);

      if (previous) {
        // An already-applied migration whose contents changed means the file was edited after
        // the fact - the database and the repo have silently diverged. Refuse rather than
        // guess: on a shared production database that is never something to paper over.
        if (previous !== checksum) {
          throw new Error(
            `Migration ${name} was already applied but its contents have changed.\n` +
              'Add a new migration file instead of editing an applied one.',
          );
        }
        console.log(`- ${name} (already applied)`);
        continue;
      }

      // Each migration runs in its own transaction, so a failure half-way leaves the schema
      // exactly as it was rather than partially built.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO "ledger"."_migrations" ("name", "checksum") VALUES ($1, $2)', [
          name,
          checksum,
        ]);
        await client.query('COMMIT');
        console.log(`+ ${name} applied`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    console.log('\nMigrations up to date.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
