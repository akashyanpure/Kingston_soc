/**
 * DEV ONLY: drop and recreate the public schema (and drizzle's migration log), migrate, seed.
 * Refuses when NODE_ENV=production. Run: pnpm --filter @soc/db reset
 */
import { sql } from 'drizzle-orm';
import { createDb } from './client.js';
import { requireDatabaseUrl, runMigrations } from './migrate.js';
import { seed } from './seed.js';

const url = requireDatabaseUrl(); // loads ../../.env first, so NODE_ENV from .env is honoured
if (process.env.NODE_ENV === 'production') {
  console.error('[reset] refusing to reset a database with NODE_ENV=production');
  process.exit(1);
}
const { db, close } = createDb(url, { max: 1 });
try {
  console.log(`[reset] dropping schema on ${new URL(url).host}${new URL(url).pathname}`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await runMigrations(db);
  console.log('[reset] migrations applied');
  await seed(db);
} finally {
  await close();
}
