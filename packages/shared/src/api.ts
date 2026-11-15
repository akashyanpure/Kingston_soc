/**
 * HTTP API contract. Base path /api. JSON unless stated. Auth: session cookie
 * (HttpOnly, SameSite=Lax) set by POST /api/auth/login (AUTH_MODE=local).
 * Errors: { error: { code: string, message: string, details?: unknown } } with a 4xx/5xx status.
 *
 * Roles: officer = own visits only; manager = all visits + properties + assign;
 * admin = manager + users + form versions + description phrases.
 *
 * | Method | Path                              | Role     | Body / query              | Response                    |
 * |--------|-----------------------------------|----------|---------------------------|-----------------------------|
 * | POST   | /auth/login                       | public   | LoginRequest              | { user: User }              |
 * | POST   | /auth/logout                      | any      | —                         | 204                         |
 * | GET    | /auth/me                          | any      | —                         | { user: User }              |
 * | GET    | /auth/dev-users                   | public*  | — (*only AUTH_MODE=local & NODE_ENV!=production) | { users: User[] } |
 * | POST   | /auth/dev-login                   | public*  | { userId }                | { user: User }              |
 * | GET    | /reference                        | any      | —                         | ReferenceData               |
 * | GET    | /visits                           | any      | VisitListQuery            | { visits: VisitSummary[] }  |
 * | POST   | /visits                           | officer+ | CreateVisitRequest        | VisitBundle (rooms/items pre-created from form) |
 * | GET    | /visits/:id                       | owner/manager | —                    | VisitBundle                 |
 * | PATCH  | /visits/:id/assign                | manager  | { officerId, scheduledAt }| { visit: Visit }            |
 * | POST   | /sync/push                        | any      | PushRequest               | PushResponse                |
 * | PUT    | /photos/:id/file                  | owner    | image/jpeg body; header x-sha256 | { photo: Photo }     |
 * | GET    | /photos/:id/file                  | owner/manager | —                    | image/jpeg                  |
 * | GET    | /visits/:id/blockers              | owner/manager | —                    | { blockers: Blocker[] }     |
 * | POST   | /visits/:id/issue                 | owner/manager | —                    | { report: Report } or 409 { blockers } |
 * | GET    | /visits/:id/preview               | owner/manager | —                    | text/html (draft report)    |
 * | GET    | /reports/:id                      | owner/manager | —                    | { report, signatures }      |
 * | GET    | /reports/:id/pdf                  | owner/manager | —                    | application/pdf (202 if rendering) |
 * | POST   | /reports/:id/signatures           | owner/manager | SignRequest          | { signature: Signature }    |
 * | POST   | /reports/:id/notes                | owner/manager | NoteRequest (post-issue, append-only) | { note }   |
 * | GET    | /properties?q=                    | any      | search address/postcode/UPRN | { properties: PropertyWithLandlord[] } |
 * | POST   | /properties                       | officer+ | CreatePropertyRequest     | { property }                |
 * | GET    | /properties/:id/visits            | any      | —                         | { visits: VisitSummary[] }  |
 * | GET    | /users                            | admin    | —                         | { users: User[] }           |
 * | POST   | /users                            | admin    | CreateUserRequest         | { user }                    |
 * | GET    | /health                           | public   | —                         | { ok: true, db: boolean }   |
 */
import { z } from 'zod';
import { PROPERTY_TYPES, ROLES, SCHEME_CODES, SIGNATURE_METHODS, SIGNATURE_ROLES, VISIT_STATUSES, VISIT_TYPES } from './enums.js';
import { DescriptionPhrase, FormVersion, Landlord, Property, Scheme, User, Visit, zDate, zId, zTime } from './schemas.js';

export const LoginRequest = z.object({ email: z.email(), password: z.string().min(1) });
export type LoginRequest = z.infer<typeof LoginRequest>;

export const ReferenceData = z.object({
  formVersion: FormVersion, // current published version; definition is a FormDefinition
  schemes: z.array(Scheme),
  phrases: z.array(DescriptionPhrase),
  officers: z.array(User.pick({ id: true, name: true, role: true })),
});
export type ReferenceData = z.infer<typeof ReferenceData>;

export const VisitListQuery = z.object({
  from: zDate.optional(),
  to: zDate.optional(),
  status: z.enum(VISIT_STATUSES).optional(),
  officerId: zId.optional(), // managers only; officers always get their own
});
export type VisitListQuery = z.infer<typeof VisitListQuery>;

export const VisitSummary = Visit.pick({
  id: true, schemeCode: true, visitType: true, status: true, scheduledAt: true, reportNumber: true, officerId: true, updatedAt: true,
}).extend({
  address: z.string(),
  postcode: z.string(),
  officerName: z.string(),
  itemsTotal: z.number().int(),
  itemsGraded: z.number().int(),
  defects: z.number().int(),
});
export type VisitSummary = z.infer<typeof VisitSummary>;

export const CreateVisitRequest = z.object({
  id: zId, // generated on the device
  propertyId: zId,
  tenancyId: zId.nullable().optional(),
  schemeCode: z.enum(SCHEME_CODES),
  visitType: z.enum(VISIT_TYPES),
  /** Room codes (FormDefinition.rooms[].code) present at the property; others get present=false. */
  presentRoomCodes: z.array(z.string()).min(1),
  scheduledAt: zTime.nullable().optional(),
});
export type CreateVisitRequest = z.infer<typeof CreateVisitRequest>;

export const SignRequest = z.object({
  role: z.enum(SIGNATURE_ROLES),
  name: z.string().min(1),
  method: z.enum(SIGNATURE_METHODS),
  /** PNG data URL of the finger signature, for method on_device. */
  imageDataUrl: z.string().startsWith('data:image/png;base64,').optional(),
});
export type SignRequest = z.infer<typeof SignRequest>;

export const NoteRequest = z.object({ noteDate: zDate, note: z.string().min(1), addedBy: z.string().min(1), signed: z.string().nullable() });
export type NoteRequest = z.infer<typeof NoteRequest>;

export const CreatePropertyRequest = Property.omit({ id: true }).extend({
  id: zId,
  propertyType: z.enum(PROPERTY_TYPES),
  landlord: Landlord.omit({ id: true }).extend({ id: zId }).nullable().optional(),
});
export type CreatePropertyRequest = z.infer<typeof CreatePropertyRequest>;

export const PropertyWithLandlord = Property.extend({ landlord: Landlord.nullable() });
export type PropertyWithLandlord = z.infer<typeof PropertyWithLandlord>;

export const CreateUserRequest = z.object({
  email: z.email(), name: z.string().min(1), role: z.enum(ROLES), password: z.string().min(12),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequest>;

export const ApiError = z.object({ error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }) });
export type ApiError = z.infer<typeof ApiError>;
