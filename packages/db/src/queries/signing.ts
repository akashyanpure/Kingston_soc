import { asc, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import {
  Dispute, SIGNING_LINK_DAYS, SigningLink,
  type LinkSignerRole, type SigningLinkStatus,
} from '@soc/shared';
import type { Db } from '../client.js';
import { disputes, itemRecords, roomInstances, signingLinks } from '../schema.js';

export type SigningLinkRow = typeof signingLinks.$inferSelect;
export type DisputeRow = typeof disputes.$inferSelect;

/** Derive a link's status. signed > revoked > expired > pending. */
export function signingLinkStatus(
  link: Pick<SigningLinkRow, 'signedAt' | 'revokedAt' | 'expiresAt'>,
  now: Date = new Date(),
): SigningLinkStatus {
  if (link.signedAt) return 'signed';
  if (link.revokedAt) return 'revoked';
  if (link.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'pending';
}

/** Map a row (+ dispute count) to the shared `SigningLink` shape. */
export function toSigningLink(row: SigningLinkRow, disputeCount: number, now: Date = new Date()): SigningLink {
  return SigningLink.parse({
    id: row.id,
    reportId: row.reportId,
    role: row.role,
    recipientName: row.recipientName,
    recipientEmail: row.recipientEmail,
    status: signingLinkStatus(row, now),
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    expiresAt: row.expiresAt.toISOString(),
    openedAt: row.openedAt?.toISOString() ?? null,
    signedAt: row.signedAt?.toISOString() ?? null,
    disputes: disputeCount,
  });
}

export interface CreateSigningLinkInput {
  id?: string;
  reportId: string;
  role: LinkSignerRole;
  /** sha256 (base64url) of the raw token. Never pass the raw token. */
  tokenHash: string;
  recipientName?: string | null;
  recipientEmail?: string | null;
  createdBy: string;
  /** Default: now + SIGNING_LINK_DAYS (14) days. */
  expiresAt?: Date;
}

/** Insert a signing link; returns the row. */
export async function createSigningLink(tx: Db, input: CreateSigningLinkInput): Promise<SigningLinkRow> {
  const [row] = await tx
    .insert(signingLinks)
    .values({
      id: input.id ?? uuidv7(),
      reportId: input.reportId,
      role: input.role,
      tokenHash: input.tokenHash,
      recipientName: input.recipientName ?? null,
      recipientEmail: input.recipientEmail ?? null,
      createdBy: input.createdBy,
      expiresAt: input.expiresAt ?? new Date(Date.now() + SIGNING_LINK_DAYS * 86_400_000),
    })
    .returning();
  return row!;
}

/** Look up a link by token hash (null if unknown). Status is NOT checked — use signingLinkStatus(). */
export async function findSigningLinkByTokenHash(db: Db, tokenHash: string): Promise<SigningLinkRow | null> {
  const [row] = await db.select().from(signingLinks).where(eq(signingLinks.tokenHash, tokenHash)).limit(1);
  return row ?? null;
}

// Raw, fully-qualified SQL: drizzle renders columns unqualified in single-table selects.
const disputeCount = sql<number>`(select count(*) from disputes d where d.signing_link_id = signing_links.id)`.mapWith(Number);

/** Links of a report (oldest first) in the shared `SigningLink` shape. */
export async function listSigningLinks(db: Db, reportId: string, now: Date = new Date()): Promise<SigningLink[]> {
  const rows = await db
    .select({ link: signingLinks, disputes: disputeCount })
    .from(signingLinks)
    .where(eq(signingLinks.reportId, reportId))
    .orderBy(asc(signingLinks.createdAt), asc(signingLinks.id));
  return rows.map((r) => toSigningLink(r.link, r.disputes, now));
}

/** One link in the shared shape (null if unknown). */
export async function getSigningLink(db: Db, id: string, now: Date = new Date()): Promise<SigningLink | null> {
  const [r] = await db.select({ link: signingLinks, disputes: disputeCount }).from(signingLinks).where(eq(signingLinks.id, id));
  return r ? toSigningLink(r.link, r.disputes, now) : null;
}

/** Disputes of a report (oldest first) in the shared `Dispute` shape; room = room label or 'MISCELLANEOUS'. */
export async function listDisputes(db: Db, reportId: string): Promise<Dispute[]> {
  const rows = await db
    .select({
      id: disputes.id, reportId: disputes.reportId, signingLinkId: disputes.signingLinkId, itemRecordId: disputes.itemRecordId,
      room: sql<string>`coalesce(${roomInstances.label}, 'MISCELLANEOUS')`, item: itemRecords.label,
      comment: disputes.comment, createdAt: disputes.createdAt, resolvedAt: disputes.resolvedAt,
    })
    .from(disputes)
    .innerJoin(itemRecords, eq(itemRecords.id, disputes.itemRecordId))
    .leftJoin(roomInstances, eq(roomInstances.id, itemRecords.roomInstanceId))
    .where(eq(disputes.reportId, reportId))
    .orderBy(asc(disputes.createdAt), asc(disputes.id));
  return rows.map((r) => Dispute.parse({ ...r, createdAt: r.createdAt.toISOString(), resolvedAt: r.resolvedAt?.toISOString() ?? null }));
}
