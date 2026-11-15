import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { photos, serializeRow } from '@soc/db';
import { Photo, zId } from '@soc/shared';
import { requireUser } from '../auth/index.js';
import { photoKey } from '../adapters/storage.js';
import type { AppContext } from '../context.js';
import { HttpError, badRequest, conflict, notFound, parse } from '../errors.js';
import { getVisitForUser } from '../services/visits.js';

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const IdParams = z.object({ id: zId });

const toPhoto = (row: typeof photos.$inferSelect) => {
  const s = serializeRow(row) as Record<string, unknown>;
  return Photo.parse(Object.fromEntries(Object.keys(Photo.shape).map((k) => [k, s[k] ?? null])));
};

export function photoRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.addContentTypeParser('image/jpeg', { parseAs: 'buffer', bodyLimit: PHOTO_MAX_BYTES }, (_req, body, done) => done(null, body));

  const load = async (id: string) => {
    const [row] = await ctx.db.select().from(photos).where(eq(photos.id, id)).limit(1);
    if (!row || row.deletedAt) throw notFound('Photo');
    return row;
  };

  app.put('/photos/:id/file', { bodyLimit: PHOTO_MAX_BYTES }, async (req) => {
    const user = requireUser(req);
    const { id } = parse(IdParams, req.params);
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the photo as an image/jpeg body.');
    if (body[0] !== 0xff || body[1] !== 0xd8 || body[2] !== 0xff) throw badRequest('Body is not a JPEG image.');
    const declared = String(req.headers['x-sha256'] ?? '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(declared)) throw badRequest('Header x-sha256 (hex SHA-256 of the body) is required.');

    const row = await load(id);
    const visit = await getVisitForUser(ctx.db, user, row.visitId);
    const actual = createHash('sha256').update(body).digest('hex');
    if (actual !== declared || actual !== row.sha256) {
      throw new HttpError(422, 'SHA256_MISMATCH', 'The uploaded file does not match its SHA-256 (corrupted upload or wrong photo).', {
        expected: row.sha256, declared, actual,
      });
    }
    if (row.uploaded) return { photo: toPhoto(row) }; // idempotent retry
    if (visit.status === 'issued') throw conflict('VISIT_ISSUED', 'This record has been issued and cannot be changed.');

    await ctx.storage.put(row.storageKey || photoKey(row.visitId, row.id), body);
    const [updated] = await ctx.db.update(photos).set({ uploaded: true }).where(eq(photos.id, id)).returning();
    return { photo: toPhoto(updated!) };
  });

  app.get('/photos/:id/file', async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(IdParams, req.params);
    const row = await load(id);
    await getVisitForUser(ctx.db, user, row.visitId);
    if (!row.uploaded) throw notFound('Photo file');
    const file = await ctx.storage.stream(row.storageKey || photoKey(row.visitId, row.id));
    if (!file) throw notFound('Photo file');
    return reply
      .header('content-type', 'image/jpeg')
      .header('content-length', file.size)
      .header('cache-control', 'private, max-age=31536000, immutable')
      .header('etag', `"${row.sha256}"`)
      .send(file.stream);
  });
}
