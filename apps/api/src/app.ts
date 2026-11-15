/**
 * Fastify app factory. All routes live under /api (see packages/shared/src/api.ts).
 *   buildApp({ db, storage, mail, config })  — used by server.ts and by tests (app.inject).
 */
import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import type { Db } from '@soc/db';
import type { Mailer } from './adapters/mail.js';
import type { Storage } from './adapters/storage.js';
import { registerAuth } from './auth/index.js';
import type { Config } from './config.js';
import type { AppContext } from './context.js';
import { registerErrorHandler } from './errors.js';
import { ChromiumPdfRenderer } from './pdf/renderer.js';
import type { PdfRenderer } from './pdf/renderer.js';
import { PdfWorker } from './pdf/worker.js';
import { photoRoutes } from './routes/photos.js';
import { propertyRoutes } from './routes/properties.js';
import { referenceRoutes } from './routes/reference.js';
import { reportRoutes, signatureImageRoutes } from './routes/reports.js';
import { syncRoutes } from './routes/sync.js';
import { userRoutes } from './routes/users.js';
import { visitRoutes } from './routes/visits.js';

export interface BuildAppOptions {
  db: Db;
  storage: Storage;
  mail: Mailer;
  config: Config;
  /** Defaults to Playwright Chromium. */
  pdf?: PdfRenderer;
}

export type App = FastifyInstance & { ctx: AppContext; pdfWorker: PdfWorker };

export async function buildApp(opts: BuildAppOptions): Promise<App> {
  const ctx: AppContext = { db: opts.db, storage: opts.storage, mail: opts.mail, config: opts.config, pdf: opts.pdf ?? new ChromiumPdfRenderer() };
  const app = Fastify({
    logger: opts.config.logLevel === 'silent' ? false : { level: opts.config.logLevel, redact: ['req.headers.cookie', 'req.headers.authorization'] },
    bodyLimit: 8 * 1024 * 1024, // sync batches + signature images
    trustProxy: false,
  });

  await app.register(cookie, { secret: opts.config.sessionSecret });
  registerErrorHandler(app);

  await app.register(
    async (api) => {
      api.get('/health', async () => {
        let db = false;
        try {
          await ctx.db.execute(sql`select 1`);
          db = true;
        } catch {
          db = false;
        }
        return { ok: true as const, db };
      });

      registerAuth(api, ctx);
      referenceRoutes(api, ctx);
      visitRoutes(api, ctx);
      syncRoutes(api, ctx);
      photoRoutes(api, ctx);
      reportRoutes(api, ctx);
      signatureImageRoutes(api, ctx);
      propertyRoutes(api, ctx);
      userRoutes(api, ctx);
    },
    { prefix: '/api' },
  );

  const worker = new PdfWorker(ctx, app.log);
  if (opts.config.pdfWorker) {
    ctx.pdfWorkerKick = () => worker.kick();
    app.addHook('onReady', async () => worker.start());
  }
  app.addHook('onClose', async () => {
    await worker.stop();
    await ctx.pdf.close();
  });

  return Object.assign(app, { ctx, pdfWorker: worker }) as unknown as App;
}
