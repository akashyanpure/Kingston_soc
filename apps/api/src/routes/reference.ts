import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { descriptionPhrases, getPublishedFormVersion, schemes, users } from '@soc/db';
import { FormVersion } from '@soc/shared';
import type { ReferenceData } from '@soc/shared';
import { requireUser } from '../auth/index.js';
import type { AppContext } from '../context.js';
import { conflict } from '../errors.js';

export function referenceRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/reference', async (req): Promise<ReferenceData> => {
    requireUser(req);
    const form = await getPublishedFormVersion(ctx.db);
    if (!form) throw conflict('NO_PUBLISHED_FORM', 'No published form version. Run the database seed.');
    const [schemeRows, phraseRows, officerRows] = await Promise.all([
      ctx.db.select().from(schemes).orderBy(asc(schemes.code)),
      ctx.db.select().from(descriptionPhrases).orderBy(asc(descriptionPhrases.itemCode), asc(descriptionPhrases.sortOrder)),
      ctx.db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(eq(users.active, true)).orderBy(asc(users.name)),
    ]);
    return {
      formVersion: FormVersion.parse({
        id: form.id, version: form.version, status: form.status, definition: form.definition, publishedAt: form.publishedAt?.toISOString() ?? null,
      }),
      schemes: schemeRows.map((s) => ({ code: s.code, name: s.name })),
      phrases: phraseRows.map((p) => ({ id: p.id, itemCode: p.itemCode, phrase: p.phrase, sortOrder: p.sortOrder })),
      officers: officerRows,
    };
  });
}
