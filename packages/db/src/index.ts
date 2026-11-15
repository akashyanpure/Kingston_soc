/**
 * @soc/db — Postgres schema (drizzle), client factories, migrations and query helpers.
 * Contract: docs/data-model.md.
 */
export * as schema from './schema.js';
export * from './schema.js';
export { createDb, createTestDb, loadRootEnv, MIGRATIONS_FOLDER } from './client.js';
export type { Db, Tx, Schema, DbHandle, TestDbHandle } from './client.js';
export { runMigrations } from './migrate.js';
export { seed, seedPhrases, SEED_USERS, DEV_PASSWORD_DEFAULT, type SeedOptions } from './seed.js';
export { DEFAULT_ROOM_PLANS } from './room-plans.js';
export * from './errors.js';
export * from './queries/index.js';
