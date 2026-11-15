/**
 * Role-specific portals (decision 2026-11-15): officers, managers and admins come to the
 * portal for different reasons, so each lands on its own home.
 *
 *   officer → /visits      "My visits"            phone-first field tool (existing)
 *   manager → /manage      Operations dashboard   desktop-first: workload, schedule, archive
 *   admin   → /admin       Administration         desktop-first: users, library, form, system
 *            (admin may also open /manage)
 *
 * Endpoints (base /api). All return { error } on failure like the rest of the API.
 *
 * MANAGER (role manager or admin)
 * | GET    | /manage/overview?from&to            | — (dates inclusive, Europe/London; default this week Mon–Sun) | ManagerOverview |
 * | GET    | /visits?officerId&status&from&to    | existing: managers see every officer's visits                  | { visits: VisitSummary[] } |
 * | POST   | /visits                             | existing CreateVisitRequest + optional officerId (manager+ only: schedule for an officer) | VisitBundle |
 * | PATCH  | /visits/:id/assign                  | existing: { officerId, scheduledAt }                           | { visit } |
 * | GET    | /manage/reports?q&from&to&scheme    | archive search (address, postcode, UPRN, report number)        | { reports: ReportSummary[] } |
 * | GET    | /properties/:id/visits              | existing: property timeline                                    | { visits } |
 *
 * ADMIN (role admin)
 * | GET    | /users                               | existing                                     | { users: User[] } |
 * | POST   | /users                               | existing CreateUserRequest                   | { user } |
 * | PATCH  | /users/:id                           | UpdateUserRequest (cannot demote/deactivate yourself) | { user } |
 * | POST   | /users/:id/reset-password            | ResetPasswordRequest; ends that user's sessions | 204 |
 * | GET    | /admin/phrases                       | —                                            | { phrases: DescriptionPhrase[] } |
 * | POST   | /admin/phrases                       | CreatePhraseRequest                          | { phrase } |
 * | DELETE | /admin/phrases/:id                   | —                                            | 204 |
 * | PATCH  | /admin/schemes/:code                 | { name }                                     | { scheme } |
 * | GET    | /admin/form                          | —                                            | FormSummary |
 * | GET    | /admin/system                        | —                                            | SystemStatus |
 * | GET    | /admin/audit?entity&limit            | limit ≤ 200 (default 50), newest first       | { events: AuditEvent[] } |
 */
import { z } from 'zod';
import { ROLES, SCHEME_CODES, VISIT_STATUSES, VISIT_TYPES, type Role } from './enums.js';
import { zDate, zId, zTime } from './schemas.js';

/** Where each role lands after sign-in. */
export const ROLE_HOME: Record<Role, string> = { officer: '/visits', manager: '/manage', admin: '/admin' };

// ── Manager ──────────────────────────────────────────────────────────────────
export const ManagerOverviewQuery = z.object({ from: zDate.optional(), to: zDate.optional() });
export type ManagerOverviewQuery = z.infer<typeof ManagerOverviewQuery>;

export const ManagerOverview = z.object({
  from: zDate,
  to: zDate,
  kpis: z.object({
    scheduled: z.number().int(),       // visits in range not yet started
    inProgress: z.number().int(),
    completed: z.number().int(),        // completed but not issued
    issued: z.number().int(),           // issued in range
    unacceptableOpen: z.number().int(), // U items on visits issued/updated in range
    unsignedByLandlord: z.number().int(), // issued in range without a landlord/agent signature
    medianMinutesPerSoc: z.number().nullable(), // started→completed for visits completed in range
  }),
  byOfficer: z.array(z.object({
    officerId: zId,
    name: z.string(),
    scheduled: z.number().int(),
    inProgress: z.number().int(),
    issued: z.number().int(),
    medianMinutes: z.number().nullable(),
  })),
  /** Action list: Unacceptable items (most recent first, max 50). */
  unacceptable: z.array(z.object({
    visitId: zId,
    address: z.string(),
    postcode: z.string(),
    room: z.string(),
    item: z.string(),
    comment: z.string().nullable(),
    officerName: z.string(),
    at: zTime,
  })),
  /** Issued reports with no landlord/agent signature (follow-up list, max 50). */
  unsigned: z.array(z.object({
    reportId: zId,
    visitId: zId,
    reportNumber: z.string(),
    address: z.string(),
    issuedAt: zTime,
  })),
});
export type ManagerOverview = z.infer<typeof ManagerOverview>;

export const ReportSearchQuery = z.object({
  q: z.string().max(100).optional(),
  from: zDate.optional(),
  to: zDate.optional(),
  scheme: z.enum(SCHEME_CODES).optional(),
});
export type ReportSearchQuery = z.infer<typeof ReportSearchQuery>;

export const ReportSummary = z.object({
  reportId: zId,
  reportNumber: z.string(),
  visitId: zId,
  propertyId: zId,
  address: z.string(),
  postcode: z.string(),
  schemeCode: z.enum(SCHEME_CODES),
  visitType: z.enum(VISIT_TYPES),
  officerName: z.string(),
  issuedAt: zTime,
  pdfReady: z.boolean(),
  defects: z.number().int(),
  landlordSigned: z.boolean(),
});
export type ReportSummary = z.infer<typeof ReportSummary>;

// ── Admin ────────────────────────────────────────────────────────────────────
export const UpdateUserRequest = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
}).refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateUserRequest = z.infer<typeof UpdateUserRequest>;

export const ResetPasswordRequest = z.object({ password: z.string().min(12) });
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequest>;

export const CreatePhraseRequest = z.object({
  itemCode: z.string().min(1).max(60), // template item code, a general-field code (e.g. FLOORING) or '*' for any item
  phrase: z.string().min(1).max(80),
  sortOrder: z.number().int().min(0).optional(),
});
export type CreatePhraseRequest = z.infer<typeof CreatePhraseRequest>;

export const UpdateSchemeRequest = z.object({ name: z.string().min(3).max(80) });
export type UpdateSchemeRequest = z.infer<typeof UpdateSchemeRequest>;

export const FormSummary = z.object({
  formVersionId: zId,
  version: z.number().int(),
  publishedAt: zTime.nullable(),
  source: z.string(),
  rooms: z.array(z.object({ code: z.string(), label: z.string(), items: z.number().int() })),
  totalItems: z.number().int(),
  conditionOptions: z.array(z.object({ code: z.string(), label: z.string(), definition: z.string() })),
  itemColumns: z.array(z.string()),
});
export type FormSummary = z.infer<typeof FormSummary>;

export const SystemStatus = z.object({
  db: z.boolean(),
  serverTime: zTime,
  uptimeSeconds: z.number(),
  counts: z.object({
    users: z.number().int(),
    properties: z.number().int(),
    visits: z.number().int(),
    reports: z.number().int(),
    photos: z.number().int(),
  }),
  visitsByStatus: z.record(z.enum(VISIT_STATUSES), z.number().int()),
  jobs: z.object({ queued: z.number().int(), running: z.number().int(), failed: z.number().int() }),
  recentFailedJobs: z.array(z.object({ id: z.number().int(), kind: z.string(), lastError: z.string().nullable(), at: zTime })),
});
export type SystemStatus = z.infer<typeof SystemStatus>;

export const AuditQuery = z.object({
  entity: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type AuditQuery = z.infer<typeof AuditQuery>;

export const AuditEvent = z.object({
  id: z.number().int(),
  entity: z.string(),
  entityId: zId,
  field: z.string(),
  oldValue: z.unknown(),
  newValue: z.unknown(),
  actorName: z.string().nullable(),
  deviceId: z.string().nullable(),
  at: zTime,
});
export type AuditEvent = z.infer<typeof AuditEvent>;
