/**
 * Admin console (role admin): description library, scheme names, form summary, system status, audit.
 * User management lives in routes/users.ts. Contract: packages/shared/src/roles.ts.
 */
import { and, asc, count, desc, eq, max, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import {
  auditEvents, descriptionPhrases, getPublishedFormVersion, isUniqueViolation, jobs, photos, properties, reports, schemes, users, visits,
} from '@soc/db';
import {
  AuditEvent, AuditQuery, CreatePhraseRequest, DescriptionPhrase, FormSummary, SCHEME_CODES, Scheme, SystemStatus,
  UpdateSchemeRequest, VISIT_STATUSES, zId,
} from '@soc/shared';
import type { FormDefinition } from '@soc/shared';
import { requireRole } from '../auth/index.js';
import type { AppContext } from '../context.js';
import { conflict, notFound, parse } from '../errors.js';

const toPhrase = (p: typeof descriptionPhrases.$inferSelect) =>
  DescriptionPhrase.parse({ id: p.id, itemCode: p.itemCode, phrase: p.phrase, sortOrder: p.sortOrder });

export function adminRoutes(app: FastifyInstance, ctx: AppContext): void {
  // ── Description library ────────────────────────────────────────────────────
  app.get('/admin/phrases', async (req) => {
    requireRole(req, 'admin');
    const rows = await ctx.db.select().from(descriptionPhrases).orderBy(asc(descriptionPhrases.itemCode), asc(descriptionPhrases.sortOrder), asc(descriptionPhrases.phrase));
    return { phrases: rows.map(toPhrase) };
  });

  app.post('/admin/phrases', async (req, reply) => {
    requireRole(req, 'admin');
    const body = parse(CreatePhraseRequest, req.body);
    const phrase = body.phrase.trim();
    let sortOrder = body.sortOrder;
    if (sortOrder === undefined) {
      const [m] = await ctx.db.select({ m: max(descriptionPhrases.sortOrder) }).from(descriptionPhrases).where(eq(descriptionPhrases.itemCode, body.itemCode));
      sortOrder = (m?.m ?? 0) + 10;
    }
    try {
      const [row] = await ctx.db.insert(descriptionPhrases).values({ id: uuidv7(), itemCode: body.itemCode, phrase, sortOrder }).returning();
      return reply.code(201).send({ phrase: toPhrase(row!) });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('DUPLICATE_PHRASE', 'This phrase already exists for this item.');
      throw err;
    }
  });

  app.delete('/admin/phrases/:id', async (req, reply) => {
    requireRole(req, 'admin');
    const { id } = parse(z.object({ id: zId }), req.params);
    const deleted = await ctx.db.delete(descriptionPhrases).where(eq(descriptionPhrases.id, id)).returning({ id: descriptionPhrases.id });
    if (!deleted.length) throw notFound('Phrase');
    return reply.code(204).send();
  });

  // ── Schemes (display name drives cover + declaration wording) ──────────────
  app.patch('/admin/schemes/:code', async (req) => {
    requireRole(req, 'admin');
    const { code } = parse(z.object({ code: z.enum(SCHEME_CODES) }), req.params);
    const body = parse(UpdateSchemeRequest, req.body);
    const [row] = await ctx.db.update(schemes).set({ name: body.name.trim() }).where(eq(schemes.code, code)).returning();
    if (!row) throw notFound('Scheme');
    return { scheme: Scheme.parse({ code: row.code, name: row.name }) };
  });

  // ── Form (read-only summary of the published version) ──────────────────────
  app.get('/admin/form', async (req) => {
    requireRole(req, 'admin');
    const fv = await getPublishedFormVersion(ctx.db);
    if (!fv) throw conflict('NO_PUBLISHED_FORM', 'No published form version. Run the database seed.');
    const def = fv.definition as FormDefinition;
    const rooms = def.rooms.map((r) => ({ code: r.code, label: r.label, items: r.items.length }));
    return FormSummary.parse({
      formVersionId: fv.id,
      version: fv.version,
      publishedAt: fv.publishedAt?.toISOString() ?? null,
      source: def.source,
      rooms,
      totalItems: rooms.reduce((n, r) => n + r.items, 0),
      conditionOptions: def.conditionOptions.map((c) => ({ code: c.code, label: c.label, definition: c.definition })),
      itemColumns: def.itemColumns,
    });
  });

  // ── System status ──────────────────────────────────────────────────────────
  app.get('/admin/system', async (req) => {
    requireRole(req, 'admin');
    let db = true;
    try {
      await ctx.db.execute(sql`select 1`);
    } catch {
      db = false;
    }
    const n = async (t: typeof users | typeof properties | typeof visits | typeof reports | typeof photos) => {
      const [r] = await ctx.db.select({ n: count() }).from(t);
      return Number(r?.n ?? 0);
    };
    const [u, p, v, r, ph] = await Promise.all([n(users), n(properties), n(visits), n(reports), n(photos)]);
    const byStatus = await ctx.db.select({ status: visits.status, n: count() }).from(visits).groupBy(visits.status);
    const jobCounts = await ctx.db.select({ status: jobs.status, n: count() }).from(jobs).groupBy(jobs.status);
    const failed = await ctx.db
      .select({ id: jobs.id, kind: jobs.kind, lastError: jobs.lastError, at: jobs.createdAt })
      .from(jobs)
      .where(eq(jobs.status, 'failed'))
      .orderBy(desc(jobs.createdAt), desc(jobs.id))
      .limit(10);
    const jobN = (s: string) => Number(jobCounts.find((j) => j.status === s)?.n ?? 0);
    return SystemStatus.parse({
      db,
      serverTime: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      counts: { users: u, properties: p, visits: v, reports: r, photos: ph },
      visitsByStatus: Object.fromEntries(VISIT_STATUSES.map((s) => [s, Number(byStatus.find((b) => b.status === s)?.n ?? 0)])),
      jobs: { queued: jobN('queued'), running: jobN('running'), failed: jobN('failed') },
      recentFailedJobs: failed.map((j) => ({ id: j.id, kind: j.kind, lastError: j.lastError?.split('\n')[0]?.slice(0, 500) ?? null, at: j.at.toISOString() })),
    });
  });

  // ── Audit trail ────────────────────────────────────────────────────────────
  app.get('/admin/audit', async (req) => {
    requireRole(req, 'admin');
    const q = parse(AuditQuery, req.query);
    const rows = await ctx.db
      .select({
        id: auditEvents.id, entity: auditEvents.entity, entityId: auditEvents.entityId, field: auditEvents.field,
        oldValue: auditEvents.oldValue, newValue: auditEvents.newValue, actorName: users.name, deviceId: auditEvents.deviceId, at: auditEvents.at,
      })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actor))
      .where(q.entity ? and(eq(auditEvents.entity, q.entity)) : undefined)
      .orderBy(desc(auditEvents.id))
      .limit(q.limit ?? 50);
    return { events: rows.map((e) => AuditEvent.parse({ ...e, actorName: e.actorName ?? null, at: e.at.toISOString() })) };
  });
}
