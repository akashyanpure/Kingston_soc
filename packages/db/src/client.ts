/**
 * Database factories.
 *   createDb(url)   — node-postgres Pool + drizzle (production / dev).
 *   createTestDb()  — in-memory PGlite with every migration applied (tests).
 * Both return a drizzle instance with `casing: 'snake_case'` and the full schema, typed as `Db`.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';
import pg from 'pg';
import * as schema from './schema.js';

export type Schema = typeof schema;

/** A drizzle database (node-postgres or PGlite). Transactions (`Tx`) are assignable to it. */
export type Db = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
/** A drizzle transaction, as passed to `db.transaction(async (tx) => …)`. */
export type Tx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

/** Absolute path of packages/db/migrations. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

export interface DbHandle {
  db: Db;
  /** Close the underlying pool / PGlite instance. */
  close: () => Promise<void>;
}

/** node-postgres pool + drizzle. Call `close()` on shutdown. */
export function createDb(databaseUrl: string, opts: { max?: number } = {}): DbHandle & { pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: opts.max ?? 10 });
  const db = drizzleNodePg({ client: pool, schema, casing: 'snake_case' });
  return { db: db as unknown as Db, pool, close: () => pool.end() };
}

// ── PGlite (tests) ───────────────────────────────────────────────────────────
let migratedImage: Promise<Blob | File | null> | undefined;

async function freshMigratedPglite(): Promise<PGlite> {
  const client = await PGlite.create({ extensions: { pg_trgm } });
  const db = drizzlePglite({ client, schema, casing: 'snake_case' });
  await migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return client;
}

/**
 * Applying the migrations once per process and cloning the resulting data directory is ~5×
 * faster than migrating every test database from scratch.
 */
async function migratedImageOnce(): Promise<Blob | File | null> {
  migratedImage ??= (async () => {
    const client = await freshMigratedPglite();
    try {
      return await client.dumpDataDir('none');
    } catch {
      return null; // dump unsupported — fall back to migrating each instance
    } finally {
      await client.close();
    }
  })();
  return migratedImage;
}

export interface TestDbHandle extends DbHandle {
  client: PGlite;
}

/**
 * In-memory PGlite database with all migrations applied (pg_trgm loaded). Each call returns an
 * independent, empty database. Pass `{ seed: true }` to also run the dev seed.
 */
export async function createTestDb(opts: { seed?: boolean } = {}): Promise<TestDbHandle> {
  const image = await migratedImageOnce();
  const client = image
    ? await PGlite.create({ extensions: { pg_trgm }, loadDataDir: image })
    : await freshMigratedPglite();
  const db = drizzlePglite({ client, schema, casing: 'snake_case' }) as unknown as Db;
  if (opts.seed) {
    const { seed } = await import('./seed.js');
    await seed(db, { quiet: true });
  }
  return { db, client, close: () => client.close() };
}

/** Load ../../.env (repo root) into process.env if it exists. */
export function loadRootEnv(): void {
  const envPath = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}
