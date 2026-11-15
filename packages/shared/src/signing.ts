/**
 * Landlord / tenant SIGNING LINKS (decision 2026-11-15, prototype "Landlord · signing link").
 *
 * When a party was not present at the visit, the officer or a manager sends them a secure,
 * expiring link after the report is issued. The signer needs no account and no app: they read
 * the report, see every item not marked Good (with photos), and either sign electronically
 * ("I agree — sign now") or dispute individual items (the officer is notified). E-signatures only
 * (no wet-signature route). A link signature is recorded against the PDF's SHA-256 and shown in
 * the online record; the already-issued PDF is never changed (immutability).
 *
 * Token: 32 random bytes (base64url) in the URL /sign/<token>; only its SHA-256 is stored.
 * Valid for 14 days, single-use for signing (disputes allowed until signed or expired).
 * Public endpoints are rate-limited and reveal nothing without a valid token.
 *
 * STAFF (owner officer of the visit, manager, admin)
 * | POST | /api/reports/:id/signing-links       | CreateSigningLinkRequest | 201 { link: SigningLink, url } (also emailed if email given) |
 * | GET  | /api/reports/:id/signing-links       | —                        | { links: SigningLink[] } |
 * | POST | /api/signing-links/:id/revoke        | —                        | { link: SigningLink } |
 * | GET  | /api/reports/:id/disputes            | —                        | { disputes: Dispute[] } |
 *
 * PUBLIC (token holder, no session)
 * | GET  | /api/sign/:token                     | —                        | SigningView (410 LINK_EXPIRED / LINK_USED / LINK_REVOKED, 404 unknown) |
 * | GET  | /api/sign/:token/pdf                 | —                        | application/pdf |
 * | GET  | /api/sign/:token/photos/:photoId     | —                        | image/jpeg (only photos in this report) |
 * | POST | /api/sign/:token                     | PublicSignRequest        | { signature: Signature } — method 'link', reportSha256 = PDF hash |
 * | POST | /api/sign/:token/disputes            | PublicDisputeRequest     | 201 { dispute: Dispute } — emails the officer |
 */
import { z } from 'zod';
import { CONDITIONS, SIGNATURE_ROLES } from './enums.js';
import { zId, zTime } from './schemas.js';

/** Roles that can be invited by link (the officer always signs on the device before issue). */
export const LINK_SIGNER_ROLES = ['landlord_agent', 'tenant_check_in', 'tenant_check_out'] as const;
export type LinkSignerRole = (typeof LINK_SIGNER_ROLES)[number];

export const SIGNING_LINK_DAYS = 14;

export const SigningLinkStatus = z.enum(['pending', 'signed', 'expired', 'revoked']);
export type SigningLinkStatus = z.infer<typeof SigningLinkStatus>;

export const SigningLink = z.object({
  id: zId,
  reportId: zId,
  role: z.enum(LINK_SIGNER_ROLES),
  recipientName: z.string().nullable(),
  recipientEmail: z.email().nullable(),
  status: SigningLinkStatus,
  createdAt: zTime,
  createdBy: zId,
  expiresAt: zTime,
  openedAt: zTime.nullable(),   // first time the signer opened the page
  signedAt: zTime.nullable(),
  disputes: z.number().int(),
});
export type SigningLink = z.infer<typeof SigningLink>;

export const CreateSigningLinkRequest = z.object({
  role: z.enum(LINK_SIGNER_ROLES),
  recipientName: z.string().min(1).max(120).optional(),
  /** If given, the link is emailed (local: .eml file; cloud later: real mail). */
  recipientEmail: z.email().optional(),
});
export type CreateSigningLinkRequest = z.infer<typeof CreateSigningLinkRequest>;

export const Dispute = z.object({
  id: zId,
  reportId: zId,
  signingLinkId: zId,
  itemRecordId: zId,
  room: z.string(),
  item: z.string(),
  comment: z.string(),
  createdAt: zTime,
  resolvedAt: zTime.nullable(),
});
export type Dispute = z.infer<typeof Dispute>;

export const SigningView = z.object({
  status: SigningLinkStatus,
  role: z.enum(LINK_SIGNER_ROLES),
  recipientName: z.string().nullable(),
  expiresAt: zTime,
  reportNumber: z.string(),
  schemeName: z.string(),
  address: z.string(),
  postcode: z.string(),
  inspectedAt: zTime.nullable(),
  issuedAt: zTime,
  officerName: z.string(),
  stats: z.object({ items: z.number().int(), belowGood: z.number().int(), photos: z.number().int() }),
  /** Items graded F/P/U (and N/A with reason) — what the signer is asked to check. */
  belowGood: z.array(z.object({
    itemRecordId: zId,
    room: z.string(),
    item: z.string(),
    condition: z.enum(CONDITIONS),
    comment: z.string().nullable(),
    photoIds: z.array(zId),
    disputed: z.boolean(),
  })),
  /** Who has already signed (names + roles only). */
  signedBy: z.array(z.object({ role: z.enum(SIGNATURE_ROLES), name: z.string(), signedAt: zTime })),
  pdfReady: z.boolean(),
});
export type SigningView = z.infer<typeof SigningView>;

export const PublicSignRequest = z.object({
  name: z.string().min(2).max(120),
  imageDataUrl: z.string().startsWith('data:image/png;base64,').max(400_000),
  /** Signer ticks "I have read the report and confirm it is a fair record". */
  confirm: z.literal(true),
});
export type PublicSignRequest = z.infer<typeof PublicSignRequest>;

export const PublicDisputeRequest = z.object({
  itemRecordId: zId,
  comment: z.string().min(5).max(1000),
});
export type PublicDisputeRequest = z.infer<typeof PublicDisputeRequest>;
