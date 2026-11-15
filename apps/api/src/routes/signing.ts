/**
 * Signing links (contract: packages/shared/src/signing.ts).
 *
 * STAFF (owner officer, manager, admin): create / list / revoke links for an ISSUED report, list disputes.
 * PUBLIC (token holder, no session): view the report summary, download the PDF and its photos,
 * sign electronically (method 'link', bound to the PDF's SHA-256) or dispute individual items.
 * Tokens are 32 random bytes (base64url); only SHA-256(token) is stored. Public routes are
 * rate-limited per IP and reveal nothing without a valid token.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import {
  createSigningLink, disputes, getSigningLink, listDisputes, listSigningLinks, reports, signatureColumns,
  signatures, signingLinkStatus, signingLinks, users, visits,
} from '@soc/db';
import type { Db, SigningLinkRow } from '@soc/db';
import { reportPhotos } from '@soc/report';
import {
  CreateSigningLinkRequest, DEFECT_CONDITIONS, PublicDisputeRequest, PublicSignRequest, SIGNING_LINK_DAYS, Signature, SigningView, zId,
} from '@soc/shared';
import type { VisitBundle } from '@soc/shared';
import { photoKey, signatureKey } from '../adapters/storage.js';
import { requireUser } from '../auth/index.js';
import type { AppContext } from '../context.js';
import { HttpError, badRequest, conflict, notFound, parse } from '../errors.js';
import { RateLimiter, TooManyRequests } from '../rate-limit.js';
import type { StoredSnapshot } from '../services/issue.js';
import { getVisitForUser } from '../services/visits.js';
import { SIGNATURE_MAX_BYTES } from '../services/sync.js';

const IdParams = z.object({ id: zId });
const TokenParams = z.object({ token: z.string() });
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // 32 bytes base64url
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url');

const ROLE_TEXT: Record<string, string> = {
  landlord_agent: 'landlord / agent', tenant_check_in: 'tenant (check-in)', tenant_check_out: 'tenant (check-out)', officer: 'officer',
};
const fmt = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
const addressOf = (b: VisitBundle) => [b.property.addressLine1, b.property.addressLine2, b.property.town].filter(Boolean).join(', ');
const liveSignatureFor = (db: Db, visitId: string, role: string) =>
  db.select({ id: signatures.id }).from(signatures)
    .where(and(eq(signatures.visitId, visitId), eq(signatures.role, role as never), isNull(signatures.deletedAt))).limit(1);

/** Items the signer is asked to check: F/P/U, and N/A with a reason, in present rooms or miscellaneous. */
function reportItems(b: VisitBundle) {
  const present = new Set(b.rooms.filter((r) => r.present).map((r) => r.id));
  return b.items.filter((i) => i.roomInstanceId === null || present.has(i.roomInstanceId));
}

export function signingRoutes(app: FastifyInstance, ctx: AppContext): void {
  // ── STAFF ──────────────────────────────────────────────────────────────────
  const loadReportFor = async (req: FastifyRequest, id: string) => {
    const user = requireUser(req);
    const [report] = await ctx.db.select().from(reports).where(eq(reports.id, id)).limit(1);
    if (!report) throw notFound('Report');
    await getVisitForUser(ctx.db, user, report.visitId);
    return { user, report };
  };

  app.post('/reports/:id/signing-links', async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const { user, report } = await loadReportFor(req, id);
    const body = parse(CreateSigningLinkRequest, req.body);
    if (!report.pdfReady || !report.sha256) throw conflict('REPORT_NOT_READY', 'The report PDF is still being generated. Try again shortly.');
    if ((await liveSignatureFor(ctx.db, report.visitId, body.role)).length) {
      throw conflict('ALREADY_SIGNED', `The ${ROLE_TEXT[body.role]} has already signed this report.`);
    }
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const row = await ctx.db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Db;
      // One pending link per role: a new link revokes the previous one.
      await tx.update(signingLinks).set({ revokedAt: now }).where(and(
        eq(signingLinks.reportId, report.id), eq(signingLinks.role, body.role), isNull(signingLinks.signedAt),
        isNull(signingLinks.revokedAt), gt(signingLinks.expiresAt, now),
      ));
      return createSigningLink(tx, {
        reportId: report.id, role: body.role, tokenHash: hashToken(token), recipientName: body.recipientName ?? null,
        recipientEmail: body.recipientEmail ?? null, createdBy: user.id, expiresAt: new Date(now.getTime() + SIGNING_LINK_DAYS * 86_400_000),
      });
    });
    const url = `${ctx.config.publicUrl}/sign/${token}`;
    if (body.recipientEmail) {
      const snap = report.snapshot as StoredSnapshot;
      try {
        await ctx.mail.send({
          to: [body.recipientEmail],
          subject: `Please check and sign: Schedule of Condition ${report.reportNumber}`,
          text: [
            `Dear ${body.recipientName ?? 'Sir/Madam'},`,
            '',
            `The Royal Borough of Kingston upon Thames has completed a Schedule of Condition and Inventory (${report.reportNumber}) for ${addressOf(snap.bundle)}, ${snap.bundle.property.postcode}, under the ${snap.schemeName}.`,
            '',
            `As the ${ROLE_TEXT[body.role]}, please read the report and either sign it electronically or tell us about any item you disagree with:`,
            '',
            url,
            '',
            `This link is personal to you and expires on ${fmt(row.expiresAt)}. You do not need an account.`,
            '',
            'Private Sector Schemes, Royal Borough of Kingston upon Thames',
          ].join('\n'),
        });
      } catch (err) {
        req.log.error({ err, linkId: row.id }, 'failed to email signing link');
      }
    }
    return reply.code(201).send({ link: await getSigningLink(ctx.db, row.id), url });
  });

  app.get('/reports/:id/signing-links', async (req) => {
    const { id } = parse(IdParams, req.params);
    const { report } = await loadReportFor(req, id);
    return { links: await listSigningLinks(ctx.db, report.id) };
  });

  app.post('/signing-links/:id/revoke', async (req) => {
    const { id } = parse(IdParams, req.params);
    const user = requireUser(req);
    const [row] = await ctx.db.select().from(signingLinks).where(eq(signingLinks.id, id)).limit(1);
    if (!row) throw notFound('Signing link');
    const [report] = await ctx.db.select({ visitId: reports.visitId }).from(reports).where(eq(reports.id, row.reportId)).limit(1);
    await getVisitForUser(ctx.db, user, report!.visitId);
    if (row.signedAt) throw conflict('LINK_USED', 'This link has already been used to sign.');
    if (!row.revokedAt) await ctx.db.update(signingLinks).set({ revokedAt: new Date() }).where(eq(signingLinks.id, id));
    return { link: await getSigningLink(ctx.db, id) };
  });

  app.get('/reports/:id/disputes', async (req) => {
    const { id } = parse(IdParams, req.params);
    const { report } = await loadReportFor(req, id);
    return { disputes: await listDisputes(ctx.db, report.id) };
  });

  // ── PUBLIC ─────────────────────────────────────────────────────────────────
  app.register(async (pub) => {
    const limiter = new RateLimiter(ctx.config.signRateLimit, 60_000);
    pub.addHook('onRequest', async (req, reply) => {
      const wait = limiter.hit(req.ip);
      if (wait) {
        reply.header('retry-after', String(wait));
        throw new TooManyRequests('RATE_LIMITED', 'Too many requests. Please wait a minute and try again.', wait);
      }
    });
    // Public pages must never be cached by shared caches or leak the token via Referer.
    pub.addHook('onSend', async (_req, reply) => {
      reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
    });

    /** Resolve a token to its link + report; 404 unknown, 410 not usable (unless allowUsed). */
    const resolve = async (req: FastifyRequest) => {
      const { token } = parse(TokenParams, req.params);
      if (!TOKEN_RE.test(token)) throw notFound('Signing link');
      const link = await ctx.db.select().from(signingLinks).where(eq(signingLinks.tokenHash, hashToken(token))).limit(1).then((r) => r[0]);
      if (!link) throw notFound('Signing link');
      const status = signingLinkStatus(link);
      if (status === 'expired') throw new HttpError(410, 'LINK_EXPIRED', 'This link has expired. Please ask the Council for a new one.');
      if (status === 'signed') throw new HttpError(410, 'LINK_USED', 'This report has already been signed with this link.');
      if (status === 'revoked') throw new HttpError(410, 'LINK_REVOKED', 'This link has been withdrawn. Please use the most recent link you were sent.');
      const [report] = await ctx.db.select().from(reports).where(eq(reports.id, link.reportId)).limit(1);
      return { link, report: report!, snap: report!.snapshot as StoredSnapshot };
    };

    pub.get('/sign/:token', async (req) => {
      const { link, report, snap } = await resolve(req);
      if (!link.openedAt) {
        await ctx.db.update(signingLinks).set({ openedAt: new Date() }).where(and(eq(signingLinks.id, link.id), isNull(signingLinks.openedAt)));
      }
      const b = snap.bundle;
      const items = reportItems(b);
      const photos = reportPhotos(b);
      const disputed = new Set((await ctx.db.select({ itemRecordId: disputes.itemRecordId }).from(disputes).where(eq(disputes.reportId, report.id))).map((d) => d.itemRecordId));
      const roomLabel = new Map(b.rooms.map((r) => [r.id, r.label]));
      const flagged = items.filter((i) => (i.condition && DEFECT_CONDITIONS.includes(i.condition)) || (i.condition === 'NA' && i.naReason?.trim()));
      const signed = await ctx.db.select({ role: signatures.role, name: signatures.name, signedAt: signatures.signedAt }).from(signatures)
        .where(and(eq(signatures.visitId, report.visitId), isNull(signatures.deletedAt))).orderBy(signatures.signedAt);
      return SigningView.parse({
        status: 'pending',
        role: link.role,
        recipientName: link.recipientName,
        expiresAt: link.expiresAt.toISOString(),
        reportNumber: report.reportNumber,
        schemeName: snap.schemeName,
        address: addressOf(b),
        postcode: b.property.postcode,
        inspectedAt: b.visit.startedAt ?? b.visit.scheduledAt ?? null,
        issuedAt: report.issuedAt.toISOString(),
        officerName: snap.officerName,
        stats: { items: items.length, belowGood: items.filter((i) => i.condition && DEFECT_CONDITIONS.includes(i.condition)).length, photos: photos.length },
        belowGood: flagged.map((i) => ({
          itemRecordId: i.id,
          room: i.roomInstanceId ? roomLabel.get(i.roomInstanceId) ?? '' : 'MISCELLANEOUS',
          item: i.label,
          condition: i.condition!,
          comment: i.condition === 'NA' ? i.naReason : i.comment,
          photoIds: photos.filter((p) => p.itemRecordId === i.id).map((p) => p.id),
          disputed: disputed.has(i.id),
        })),
        signedBy: signed.map((s) => ({ role: s.role, name: s.name, signedAt: s.signedAt.toISOString() })),
        pdfReady: report.pdfReady,
      });
    });

    pub.get('/sign/:token/pdf', async (req, reply) => {
      const { report } = await resolve(req);
      if (!report.pdfReady || !report.pdfStorageKey) return reply.code(202).header('retry-after', '5').send({ status: 'rendering' });
      const file = await ctx.storage.stream(report.pdfStorageKey);
      if (!file) throw notFound('Report PDF');
      return reply
        .header('content-type', 'application/pdf')
        .header('content-length', file.size)
        .header('content-disposition', `inline; filename="${report.reportNumber}.pdf"`)
        .send(file.stream);
    });

    pub.get('/sign/:token/photos/:photoId', async (req, reply) => {
      const { snap } = await resolve(req);
      const { photoId } = parse(z.object({ token: z.string(), photoId: zId }), req.params);
      const photo = reportPhotos(snap.bundle).find((p) => p.id === photoId); // only this report's (non-deleted) photos
      if (!photo) throw notFound('Photo');
      const file = await ctx.storage.stream(photoKey(snap.bundle.visit.id, photo.id));
      if (!file) throw notFound('Photo');
      return reply.header('content-type', 'image/jpeg').header('content-length', file.size).send(file.stream);
    });

    pub.post('/sign/:token', async (req, reply) => {
      const { link, report, snap } = await resolve(req);
      const body = parse(PublicSignRequest, req.body);
      if (!report.pdfReady || !report.sha256) throw conflict('REPORT_NOT_READY', 'The report is still being prepared. Please try again in a minute.');
      const png = Buffer.from(body.imageDataUrl.slice('data:image/png;base64,'.length), 'base64');
      if (png.length > SIGNATURE_MAX_BYTES) throw new HttpError(413, 'TOO_LARGE', 'The signature image is too large.');
      if (png.length < 8 || !png.subarray(0, 8).equals(PNG_MAGIC)) throw badRequest('The signature image is not a PNG.');

      const id = uuidv7();
      const key = signatureKey(report.visitId, id);
      await ctx.storage.put(key, png);
      const now = new Date();
      try {
        await ctx.db.transaction(async (txRaw) => {
          const tx = txRaw as unknown as Db;
          const [locked] = await tx.select().from(signingLinks).where(eq(signingLinks.id, link.id)).limit(1).for('update');
          if (!locked || signingLinkStatus(locked as SigningLinkRow, now) !== 'pending') throw new HttpError(410, 'LINK_USED', 'This link can no longer be used.');
          if ((await liveSignatureFor(tx, report.visitId, link.role)).length) throw conflict('ALREADY_SIGNED', 'This report has already been signed for this role.');
          await tx.insert(signatures).values({
            id, visitId: report.visitId, reportId: report.id, role: link.role, name: body.name.trim(), method: 'link', signedAt: now,
            contentSha256: snap.contentSha256 ?? null, reportSha256: report.sha256, imageStorageKey: key,
            ip: req.ip ?? null, userAgent: req.headers['user-agent']?.slice(0, 500) ?? null, updatedAt: now, updatedBy: null,
          });
          await tx.update(signingLinks).set({ signedAt: now, signatureId: id }).where(eq(signingLinks.id, link.id));
        });
      } catch (err) {
        await ctx.storage.delete(key).catch(() => {});
        throw err;
      }
      const [row] = await ctx.db.select(signatureColumns).from(signatures).where(eq(signatures.id, id));
      await notifyOfficer(ctx, report.visitId, `Signed: ${report.reportNumber}`,
        `${body.name.trim()} (${ROLE_TEXT[link.role]}) signed Schedule of Condition ${report.reportNumber} for ${addressOf(snap.bundle)} electronically on ${fmt(now)}.`, req);
      return reply.code(201).send({ signature: Signature.parse(serialize(row!)) });
    });

    pub.post('/sign/:token/disputes', async (req, reply) => {
      const { link, report, snap } = await resolve(req);
      const body = parse(PublicDisputeRequest, req.body);
      const item = reportItems(snap.bundle).find((i) => i.id === body.itemRecordId);
      if (!item) throw new HttpError(404, 'ITEM_NOT_IN_REPORT', 'That item is not part of this report.');
      const id = uuidv7();
      await ctx.db.insert(disputes).values({ id, reportId: report.id, signingLinkId: link.id, itemRecordId: item.id, comment: body.comment.trim() });
      const dispute = (await listDisputes(ctx.db, report.id)).find((d) => d.id === id)!;
      await notifyOfficer(ctx, report.visitId, `Item disputed: ${report.reportNumber} — ${dispute.room} / ${dispute.item}`, [
        `The ${ROLE_TEXT[link.role]}${link.recipientName ? ` (${link.recipientName})` : ''} disputed an item in Schedule of Condition ${report.reportNumber} for ${addressOf(snap.bundle)}:`,
        '',
        `${dispute.room} / ${dispute.item}`,
        `"${dispute.comment}"`,
        '',
        'Agree any change as an additional note initialled by both parties.',
      ].join('\n'), req);
      return reply.code(201).send({ dispute });
    });
  });
}

const serialize = (r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]));

async function notifyOfficer(ctx: AppContext, visitId: string, subject: string, text: string, req: FastifyRequest) {
  try {
    const [o] = await ctx.db.select({ email: users.email, name: users.name }).from(visits).innerJoin(users, eq(users.id, visits.officerId)).where(eq(visits.id, visitId)).limit(1);
    if (!o) return;
    const cc = ctx.config.mailTeamInbox ? [ctx.config.mailTeamInbox] : [];
    await ctx.mail.send({ to: [o.email], cc, subject, text: `Dear ${o.name},\n\n${text}\n` });
  } catch (err) {
    req.log.error({ err }, 'failed to notify officer');
  }
}

