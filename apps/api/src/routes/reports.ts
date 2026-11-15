import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { additionalNotes, isUniqueViolation, reports, serializeRow, signatures } from '@soc/db';
import { AdditionalNote, NoteRequest, Signature, SignRequest, zId } from '@soc/shared';
import { requireUser } from '../auth/index.js';
import { signatureKey } from '../adapters/storage.js';
import type { AppContext } from '../context.js';
import { HttpError, badRequest, conflict, notFound, parse } from '../errors.js';
import { toReport } from '../services/issue.js';
import { getVisitForUser } from '../services/visits.js';

const IdParams = z.object({ id: zId });
const SIGNATURE_MAX_BYTES = 512 * 1024;

const toSignature = (r: typeof signatures.$inferSelect) =>
  Signature.parse({ id: r.id, reportId: r.reportId, role: r.role, name: r.name, method: r.method, signedAt: r.signedAt.toISOString(), reportSha256: r.reportSha256 });

export function reportRoutes(app: FastifyInstance, ctx: AppContext): void {
  const loadReport = async (req: Parameters<typeof requireUser>[0]) => {
    const user = requireUser(req);
    const { id } = parse(IdParams, req.params);
    const [report] = await ctx.db.select().from(reports).where(eq(reports.id, id)).limit(1);
    if (!report) throw notFound('Report');
    await getVisitForUser(ctx.db, user, report.visitId);
    return { user, report };
  };

  app.get('/reports/:id', async (req) => {
    const { report } = await loadReport(req);
    const sigs = await ctx.db.select().from(signatures).where(eq(signatures.reportId, report.id)).orderBy(asc(signatures.signedAt));
    return { report: toReport(report), signatures: sigs.map(toSignature) };
  });

  app.get('/reports/:id/pdf', async (req, reply) => {
    const { report } = await loadReport(req);
    if (!report.pdfReady || !report.pdfStorageKey) {
      return reply.code(202).header('retry-after', '3').send({ status: 'rendering', reportId: report.id });
    }
    const file = await ctx.storage.stream(report.pdfStorageKey);
    if (!file) throw notFound('Report PDF');
    return reply
      .header('content-type', 'application/pdf')
      .header('content-length', file.size)
      .header('content-disposition', `inline; filename="${report.reportNumber}.pdf"`)
      .header('cache-control', 'private, max-age=31536000, immutable')
      .header('etag', `"${report.sha256}"`)
      .send(file.stream);
  });

  app.post('/reports/:id/signatures', async (req, reply) => {
    const { report } = await loadReport(req);
    const body = parse(SignRequest, req.body);
    if (!report.sha256) throw conflict('REPORT_NOT_READY', 'The report PDF is still being generated; signatures bind to its SHA-256. Try again shortly.');
    if (body.method === 'on_device' && !body.imageDataUrl) throw badRequest('An on-device signature needs imageDataUrl.');

    const id = uuidv7();
    let imageStorageKey: string | null = null;
    if (body.imageDataUrl) {
      const png = Buffer.from(body.imageDataUrl.slice('data:image/png;base64,'.length), 'base64');
      if (png.length > SIGNATURE_MAX_BYTES) throw new HttpError(413, 'TOO_LARGE', 'Signature image is too large.');
      if (png.length < 8 || png.readUInt32BE(0) !== 0x89504e47) throw badRequest('Signature image is not a PNG.');
      imageStorageKey = signatureKey(report.id, id);
      await ctx.storage.put(imageStorageKey, png);
    }
    try {
      const [row] = await ctx.db.insert(signatures).values({
        id, reportId: report.id, role: body.role, name: body.name, method: body.method, signedAt: new Date(),
        reportSha256: report.sha256, imageStorageKey, ip: req.ip ?? null, userAgent: req.headers['user-agent']?.slice(0, 500) ?? null,
      }).returning();
      return reply.code(201).send({ signature: toSignature(row!) });
    } catch (err) {
      if (imageStorageKey) await ctx.storage.delete(imageStorageKey).catch(() => {});
      if (isUniqueViolation(err)) throw conflict('ALREADY_SIGNED', `This report already has a ${body.role} signature.`);
      throw err;
    }
  });

  app.post('/reports/:id/notes', async (req, reply) => {
    const { user, report } = await loadReport(req);
    const body = parse(NoteRequest, req.body);
    const now = new Date();
    const [row] = await ctx.db.insert(additionalNotes).values({
      id: uuidv7(), visitId: report.visitId, noteDate: body.noteDate, note: body.note, addedBy: body.addedBy, signed: body.signed,
      updatedAt: now, updatedBy: user.id,
    }).returning();
    const s = serializeRow(row!) as Record<string, unknown>;
    const note = AdditionalNote.parse(Object.fromEntries(Object.keys(AdditionalNote.shape).map((k) => [k, s[k] ?? null])));
    return reply.code(201).send({ note });
  });
}
