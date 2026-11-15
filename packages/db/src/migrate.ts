/**
 * Apply migrations/ to DATABASE_URL (node-postgres). Run: pnpm --filter @soc/db migrate
 */
import { pathToFileURL } from 'node:url';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { MIGRATIONS_FOLDER, createDb, loadRootEnv, type Db } from './client.js';

/** Apply all pending migrations using a node-postgres drizzle instance from createDb(). */
export async function runMigrations(db: Db): Promise<void> {
  await migrateNodePg(db as unknown as NodePgDatabase, { migrationsFolder: MIGRATIONS_FOLDER });
}

export function requireDatabaseUrl(): string {
  loadRootEnv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set (create .env at the repo root from .env.example)');
    process.exit(1);
  }
  return url;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { db, close } = createDb(requireDatabaseUrl(), { max: 1 });
  try {
    await runMigrations(db);
    console.log('[migrate] migrations applied');
  } finally {
    await close();
  }
}
