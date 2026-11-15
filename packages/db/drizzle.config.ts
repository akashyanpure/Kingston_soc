import { defineConfig } from 'drizzle-kit';

// Only `generate` is used (migrations are applied by src/migrate.ts / createTestDb),
// so no DATABASE_URL is needed here.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  casing: 'snake_case',
  strict: true,
  verbose: true,
});
