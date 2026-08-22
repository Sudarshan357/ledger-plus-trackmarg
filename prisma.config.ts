import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// DDL goes through DIRECT_URL (port 5432), never the pooled 6543 string - PgBouncer's
// transaction-mode pooling cannot hold the session-level advisory locks the migration engine
// takes. Same dual-URL arrangement as the Trackmarg transport app.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
    directUrl: env('DIRECT_URL'),
  },
});
