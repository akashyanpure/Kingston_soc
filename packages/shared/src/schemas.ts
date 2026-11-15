/**
 * Entity shapes as they travel over the API and live in the device store (IndexedDB).
 * camelCase here; the database uses snake_case (see packages/db). One zod schema per
 * table in docs/data-model.md. Times are ISO-8601 strings; ids are UUIDs (v7
 * preferred, generated on the device for offline-created records).
 */
import { z } from 'zod';
import {
  CONDITIONS, ROLES, SCHEME_CODES, SIGNATURE_METHODS, SIGNATURE_ROLES,
  TENANCY_STATUSES, VISIT_STATUSES, VISIT_TYPES, FORM_VERSION_STATUSES,
} from './enums.js';

export const zId = z.uuid();
export const zTime = z.iso.datetime({ offset: true });
export const zDate = z.iso.date();

// ── Reference ────────────────────────────────────────────────────────────────
export const User = z.object({
  id: zId,
  email: z.email(),
  name: z.string().min(1),
  role: z.enum(ROLES),
  active: z.boolean(),
});
export type User = z.infer<typeof User>;

export const Scheme = z.object({ code: z.enum(SCHEME_CODES), name: z.string() });
export type Scheme = z.infer<typeof Scheme>;

export const FormVersion = z.object({
  id: zId,
  version: z.number().int().positive(),
  status: z.enum(FORM_VERSION_STATUSES),
  definition: z.unknown(), // FormDefinition (see form.ts)
  publishedAt: zTime.nullable(),
});
export type FormVersion = z.infer<typeof FormVersion>;

export const DescriptionPhrase = z.object({
  id: zId,
  itemCode: z.string(),
  phrase: z.string().min(1),
  sortOrder: z.number().int(),
});
export type DescriptionPhrase = z.infer<typeof DescriptionPhrase>;

// ── Properties and people ────────────────────────────────────────────────────
export const Landlord = z.object({
  id: zId,
  name: z.string().min(1),
  company: z.string().nullable(),
  email: z.email().nullable(),
  phone: z.string().nullable(),
});
export type Landlord = z.infer<typeof Landlord>;

export const Property = z.object({
  id: zId,
  uprn: z.string().nullable(),
  addressLine1: z.string().min(1),
  addressLine2: z.string().nullable(),
  town: z.string(),
  postcode: z.string().min(5),
  propertyType: z.string(),
  bedrooms: z.number().int().min(0).nullable(),
  landlordId: zId.nullable(),
});
export type Property = z.infer<typeof Property>;

export const Tenancy = z.object({
  id: zId,
  propertyId: zId,
  schemeCode: z.enum(SCHEME_CODES),
  tenantName: z.string().nullable(),
  startDate: zDate.nullable(),
  endDate: zDate.nullable(),
  status: z.enum(TENANCY_STATUSES),
});
export type Tenancy = z.infer<typeof Tenancy>;

// ── Visit (one Schedule of Condition) — device-writable via sync ─────────────
const syncMeta = { updatedAt: zTime, updatedBy: zId.nullable() };

export const Visit = z.object({
  id: zId,
  propertyId: zId,
  tenancyId: zId.nullable(),
  schemeCode: z.enum(SCHEME_CODES),
  visitType: z.enum(VISIT_TYPES),
  formVersionId: zId,
  officerId: zId,
  status: z.enum(VISIT_STATUSES),
  scheduledAt: zTime.nullable(),
  startedAt: zTime.nullable(),
  completedAt: zTime.nullable(),
  reportNumber: z.string().regex(/^SOC-\d{4}-\d{4,}$/).nullable(), // assigned by server at issue
  ...syncMeta,
});
export type Visit = z.infer<typeof Visit>;

export const VisitGeneral = z.object({
  id: zId,
  visitId: zId,
  fieldCode: z.string(), // FormDefinition.general[].code
  value: z.string(),
  ...syncMeta,
});
export type VisitGeneral = z.infer<typeof VisitGeneral>;

export const Appliance = z.object({
  id: zId,
  visitId: zId,
  applianceCode: z.string(), // HOB | OVEN | EXTRACTOR
  make: z.string().nullable(),
  model: z.string().nullable(),
  serial: z.string().nullable(),
  ...syncMeta,
});
export type Appliance = z.infer<typeof Appliance>;

export const MeterReading = z.object({
  id: zId,
  visitId: zId,
  service: z.string(), // ELECTRICITY | GAS | WATER | STOPCOCK
  location: z.string().nullable(),
  readingIn: z.string().nullable(),
  readingOut: z.string().nullable(),
  photoId: zId.nullable(),
  ...syncMeta,
});
export type MeterReading = z.infer<typeof MeterReading>;

export const RoomInstance = z.object({
  id: zId,
  visitId: zId,
  roomCode: z.string(), // FormDefinition.rooms[].code; extra rooms reuse a code with a new label
  label: z.string(),
  sortOrder: z.number().int(),
  present: z.boolean(), // decision 3: not-present rooms are omitted from the report
  widePhotoId: zId.nullable(),
  ...syncMeta,
});
export type RoomInstance = z.infer<typeof RoomInstance>;

export const ItemRecord = z.object({
  id: zId,
  visitId: zId,
  roomInstanceId: zId.nullable(), // null => MISCELLANEOUS section
  itemCode: z.string().nullable(), // null for miscellaneous / one-off items
  label: z.string().min(1),
  sortOrder: z.number().int(),
  qty: z.number().int().min(0).nullable(),
  description: z.string().nullable(),
  condition: z.enum(CONDITIONS).nullable(), // null = not yet graded
  naReason: z.string().nullable(),
  comment: z.string().nullable(),
  dilapidation: z.string().nullable(),
  ...syncMeta,
});
export type ItemRecord = z.infer<typeof ItemRecord>;

export const Photo = z.object({
  id: zId,
  visitId: zId,
  roomInstanceId: zId.nullable(),
  itemRecordId: zId.nullable(),
  ref: z.string().nullable(), // "P-13", assigned by server at issue (stable order: capturedAt)
  capturedAt: zTime,
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  stampText: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  uploaded: z.boolean(), // binary received by server
  deletedAt: zTime.nullable(),
  ...syncMeta,
});
export type Photo = z.infer<typeof Photo>;

export const AdditionalNote = z.object({
  id: zId,
  visitId: zId,
  noteDate: zDate,
  note: z.string().min(1),
  addedBy: z.string().min(1),
  signed: z.string().nullable(), // initials of both parties
  ...syncMeta,
});
export type AdditionalNote = z.infer<typeof AdditionalNote>;

// ── Issue and sign-off (server-created) ──────────────────────────────────────
export const Report = z.object({
  id: zId,
  visitId: zId,
  reportNumber: z.string(),
  sha256: z.string().nullable(), // null until the PDF has rendered
  pdfReady: z.boolean(),
  issuedAt: zTime,
  issuedBy: zId,
});
export type Report = z.infer<typeof Report>;

export const Signature = z.object({
  id: zId,
  reportId: zId,
  role: z.enum(SIGNATURE_ROLES),
  name: z.string().min(1),
  method: z.enum(SIGNATURE_METHODS),
  signedAt: zTime,
  reportSha256: z.string().nullable(),
});
export type Signature = z.infer<typeof Signature>;

/** Everything the device needs to work on one visit offline. */
export const VisitBundle = z.object({
  visit: Visit,
  property: Property,
  landlord: Landlord.nullable(),
  tenancy: Tenancy.nullable(),
  general: z.array(VisitGeneral),
  appliances: z.array(Appliance),
  meters: z.array(MeterReading),
  rooms: z.array(RoomInstance),
  items: z.array(ItemRecord),
  photos: z.array(Photo),
  notes: z.array(AdditionalNote),
  report: Report.nullable(),
  signatures: z.array(Signature),
});
export type VisitBundle = z.infer<typeof VisitBundle>;
