import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  UnknownRoomCodeError, auditEvents, createVisitFromForm, getPublishedFormVersion, listVisits, loadVisitBundle,
  properties, reports, serializeRow, tenancies, users, visits,
} from '@soc/db';
import type { Db } from '@soc/db';
import { renderReportHtml } from '@soc/report';
import { CreateVisitRequest, Visit, VisitListQuery, visitContentHash, zId, zTime } from '@soc/shared';
import { assertCanAccessVisit, isManager, requireRole, requireUser } from '../auth/index.js';
import type { AppContext } from '../context.js';
import { badRequest, conflict, forbidden, notFound, parse } from '../errors.js';
import { IssueBlockedError, issueVisit, serverIssueBlockers } from '../services/issue.js';
import type { StoredSnapshot } from '../services/issue.js';
import { getFormDefinition, getSchemeName, getUserName, getVisitForUser } from '../services/visits.js';

const IdParams = z.object({ id: zId });
const AssignRequest = z.object({ officerId: zId, scheduledAt: zTime.nullable() });

/** Locks the HTML preview down: no scripts, images only from this origin or data URIs. */
export const REPORT_CSP = "default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; font-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

export function visitRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/visits', async (req) => {
    const user = requireUser(req);
    const q = parse(VisitListQuery, req.query);
    const filter = { ...q, officerId: isManager(user) ? q.officerId : user.id };
    return { visits: await listVisits(ctx.db, filter) };
  });

  app.post('/visits', async (req, reply) => {
    const user = requireRole(req, 'officer', 'manager', 'admin');
    const body = parse(CreateVisitRequest, req.body);

    // Idempotent: the device generated the id, so a retried create returns the existing bundle.
    const [existing] = await ctx.db.select().from(visits).where(eq(visits.id, body.id)).limit(1);
    if (existing) {
      assertCanAccessVisit(user, existing);
      if (existing.propertyId !== body.propertyId) throw conflict('CONFLICT', 'A different visit already uses this id.');
      return reply.code(200).send(await loadVisitBundle(ctx.db, body.id));
    }

    // Managers/admins may schedule a visit for an officer; officers always create their own.
    let officerId = user.id;
    if (body.officerId && body.officerId !== user.id) {
      if (!isManager(user)) throw forbidden('Officers can only create visits for themselves.');
      const [target] = await ctx.db.select({ role: users.role, active: users.active }).from(users).where(eq(users.id, body.officerId)).limit(1);
      if (!target || !target.active || target.role !== 'officer') throw badRequest('officerId must be an active officer.');
      officerId = body.officerId;
    }

    const [property] = await ctx.db.select({ id: properties.id }).from(properties).where(eq(properties.id, body.propertyId)).limit(1);
    if (!property) throw notFound('Property');
    if (body.tenancyId) {
      const [ten] = await ctx.db.select({ id: tenancies.id }).from(tenancies)
        .where(and(eq(tenancies.id, body.tenancyId), eq(tenancies.propertyId, body.propertyId))).limit(1);
      if (!ten) throw badRequest('Tenancy does not belong to this property.');
    }
    const form = await getPublishedFormVersion(ctx.db);
    if (!form) throw conflict('NO_PUBLISHED_FORM', 'No published form version. Run the database seed.');
    try {
      await ctx.db.transaction(async (tx) => {
        await createVisitFromForm(tx as unknown as Db, body, officerId, form);
      });
    } catch (err) {
      if (err instanceof UnknownRoomCodeError) throw badRequest(err.message, { codes: err.codes });
      throw err;
    }
    return reply.code(201).send(await loadVisitBundle(ctx.db, body.id));
  });

  app.get('/visits/:id', async (req) => {
    const user = requireUser(req);
    const { id } = parse(IdParams, req.params);
    await getVisitForUser(ctx.db, user, id);
    return loadVisitBundle(ctx.db, id);
  });

  app.patch('/visits/:id/assign', async (req) => {
    const user = requireRole(req, 'manager', 'admin');
    const { id } = parse(IdParams, req.params);
    const body = parse(AssignRequest, req.body);
    const visit = await getVisitForUser(ctx.db, user, id);
    if (visit.status === 'issued') throw conflict('VISIT_ISSUED', 'This record has been issued and cannot be changed.');
    const [officer] = await ctx.db.select().from(users).where(eq(users.id, body.officerId)).limit(1);
    if (!officer || !officer.active) throw badRequest('Officer not found or inactive.');
    const now = new Date();
    const updated = await ctx.db.transaction(async (tx) => {
      const [row] = await tx.update(visits)
        .set({ officerId: body.officerId, scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null, updatedAt: now, updatedBy: user.id })
        .where(eq(visits.id, id)).returning();
      // Server writes join the per-field LWW history like device writes.
      await tx.insert(auditEvents).values([
        { entity: 'visit', entityId: id, field: 'officerId', oldValue: visit.officerId, newValue: body.officerId, actor: user.id, clientUpdatedAt: now },
        { entity: 'visit', entityId: id, field: 'scheduledAt', oldValue: visit.scheduledAt?.toISOString() ?? null, newValue: body.scheduledAt, actor: user.id, clientUpdatedAt: now },
      ]);
      return row!;
    });
    return { visit: Visit.parse(serializeRow(updated)) };
  });

  app.get('/visits/:id/blockers', async (req) => {
    const user = requireUser(req);
    const { id } = parse(IdParams, req.params);
    await getVisitForUser(ctx.db, user, id);
    const bundle = (await loadVisitBundle(ctx.db, id))!;
    return { blockers: serverIssueBlockers(bundle) };
  });

  app.post('/visits/:id/issue', async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(IdParams, req.params);
    try {
      const report = await issueVisit(ctx.db, user, id);
      ctx.pdfWorkerKick?.();
      return reply.code(201).send({ report });
    } catch (err) {
      if (err instanceof IssueBlockedError) {
        // Contract: 409 { blockers } — also wrapped in the standard error shape.
        return reply.code(409).send({ error: { code: err.code, message: err.message, details: err.details }, blockers: err.blockers });
      }
      throw err;
    }
  });

  app.get('/visits/:id/preview', async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(IdParams, req.params);
    const visit = await getVisitForUser(ctx.db, user, id);
    const photoSrc = (photoId: string) => `/api/photos/${photoId}/file`;
    const signatureSrc = (signatureId: string) => `/api/signatures/${signatureId}/image`;
    let html: string;
    const [report] = visit.status === 'issued' ? await ctx.db.select().from(reports).where(eq(reports.visitId, id)).limit(1) : [];
    if (report) {
      const snap = report.snapshot as StoredSnapshot;
      html = renderReportHtml({ ...snap, mode: 'final', sha256: snap.contentSha256, issuedAt: snap.issuedAt ?? null, photoSrc, signatureSrc });
    } else {
      const bundle = (await loadVisitBundle(ctx.db, id))!;
      html = renderReportHtml({
        bundle,
        form: await getFormDefinition(ctx.db, visit.formVersionId),
        schemeName: await getSchemeName(ctx.db, visit.schemeCode),
        officerName: await getUserName(ctx.db, visit.officerId),
        mode: 'draft',
        // The draft shows the content hash the signers are agreeing to.
        sha256: visitContentHash(bundle),
        photoSrc,
        signatureSrc,
      });
    }
    return reply
      .header('content-type', 'text/html; charset=utf-8')
      .header('content-security-policy', REPORT_CSP)
      .header('cache-control', 'no-store')
      .send(html);
  });
}
