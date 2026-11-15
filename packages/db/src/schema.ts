/**
 * Drizzle schema — implements docs/data-model.md.
 *
 * Every TS property is the camelCase name of the matching zod schema field in
 * @soc/shared; the database column is its snake_case form (drizzle `casing:
 * 'snake_case'` — always create drizzle instances through ./client.ts).
 *
 * Things drizzle cannot express live in the custom SQL migration
 * (migrations/*_constraints_triggers.sql): pg_trgm + trigram index, the
 * immutability triggers, and the DEFERRABLE photo FKs
 * (room_instances.wide_photo_id, meter_readings.photo_id).
 */
import { sql } from 'drizzle-orm';
import {
  bigint, boolean, check, date, doublePrecision, index, inet, integer, jsonb, pgEnum, pgTable,
  text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import {
  CONDITIONS, FORM_VERSION_STATUSES, ROLES, SCHEME_CODES, SIGNATURE_METHODS, SIGNATURE_ROLES,
  TENANCY_STATUSES, VISIT_STATUSES, VISIT_TYPES,
} from '@soc/shared';

// ── Enums (named after the enums.ts constants) ──────────────────────────────
export const rolesEnum = pgEnum('roles', ROLES);
export const conditionsEnum = pgEnum('conditions', CONDITIONS);
export const visitTypesEnum = pgEnum('visit_types', VISIT_TYPES);
export const visitStatusesEnum = pgEnum('visit_statuses', VISIT_STATUSES);
export const tenancyStatusesEnum = pgEnum('tenancy_statuses', TENANCY_STATUSES);
export const formVersionStatusesEnum = pgEnum('form_version_statuses', FORM_VERSION_STATUSES);
export const signatureRolesEnum = pgEnum('signature_roles', SIGNATURE_ROLES);
export const signatureMethodsEnum = pgEnum('signature_methods', SIGNATURE_METHODS);
export const schemeCodesEnum = pgEnum('scheme_codes', SCHEME_CODES);

export const JOB_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

// ── Column helpers ───────────────────────────────────────────────────────────
const tstz = () => timestamp({ withTimezone: true, mode: 'date' });
const createdAt = () => tstz().notNull().defaultNow();

/** Sync columns on device-writable tables. */
const syncColumns = () => ({
  updatedAt: tstz().notNull().defaultNow(),
  updatedBy: uuid().references(() => users.id),
  createdAt: createdAt(),
  deletedAt: tstz(),
});

// ── Reference ────────────────────────────────────────────────────────────────
export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey(),
    email: text().notNull(),
    name: text().notNull(),
    role: rolesEnum().notNull(),
    active: boolean().notNull().default(true),
    passwordHash: text(), // argon2id; null once SSO-only
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`)],
);

export const schemes = pgTable('schemes', {
  code: schemeCodesEnum().primaryKey(),
  name: text().notNull(),
});

export const formVersions = pgTable(
  'form_versions',
  {
    id: uuid().primaryKey(),
    version: integer().notNull().unique(),
    status: formVersionStatusesEnum().notNull().default('draft'),
    definition: jsonb().notNull(),
    publishedAt: tstz(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('form_versions_one_published_uq').on(t.status).where(sql`status = 'published'`)],
);

export const descriptionPhrases = pgTable(
  'description_phrases',
  {
    id: uuid().primaryKey(),
    itemCode: text().notNull(),
    phrase: text().notNull(),
    sortOrder: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index('description_phrases_item_sort_idx').on(t.itemCode, t.sortOrder),
    // Addition (not in data-model.md): makes the seed idempotent and stops duplicates.
    uniqueIndex('description_phrases_item_phrase_uq').on(t.itemCode, t.phrase),
  ],
);

// ── Properties and people ────────────────────────────────────────────────────
export const landlords = pgTable('landlords', {
  id: uuid().primaryKey(),
  name: text().notNull(),
  company: text(),
  email: text(),
  phone: text(),
  createdAt: createdAt(),
});

export const properties = pgTable(
  'properties',
  {
    id: uuid().primaryKey(),
    uprn: text(),
    addressLine1: text().notNull(),
    addressLine2: text(),
    town: text().notNull().default('Kingston upon Thames'),
    postcode: text().notNull(),
    propertyType: text().notNull(),
    bedrooms: integer(),
    landlordId: uuid().references(() => landlords.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('properties_uprn_uq').on(t.uprn).where(sql`uprn is not null`),
    index('properties_postcode_lower_idx').on(sql`lower(${t.postcode})`),
    index('properties_landlord_idx').on(t.landlordId),
    // trigram index on address_line1: custom migration (needs pg_trgm)
  ],
);

export const tenancies = pgTable(
  'tenancies',
  {
    id: uuid().primaryKey(),
    propertyId: uuid().notNull().references(() => properties.id),
    schemeCode: schemeCodesEnum().notNull().references(() => schemes.code),
    tenantName: text(),
    startDate: date({ mode: 'string' }),
    endDate: date({ mode: 'string' }),
    status: tenancyStatusesEnum().notNull().default('pending'),
    createdAt: createdAt(),
  },
  (t) => [index('tenancies_property_idx').on(t.propertyId)],
);

// ── Visit (device-writable) ──────────────────────────────────────────────────
export const visits = pgTable(
  'visits',
  {
    id: uuid().primaryKey(),
    propertyId: uuid().notNull().references(() => properties.id),
    tenancyId: uuid().references(() => tenancies.id),
    schemeCode: schemeCodesEnum().notNull().references(() => schemes.code),
    visitType: visitTypesEnum().notNull(),
    formVersionId: uuid().notNull().references(() => formVersions.id),
    officerId: uuid().notNull().references(() => users.id),
    status: visitStatusesEnum().notNull().default('scheduled'),
    scheduledAt: tstz(),
    startedAt: tstz(),
    completedAt: tstz(),
    reportNumber: text().unique(),
    ...syncColumns(),
  },
  (t) => [
    index('visits_officer_scheduled_idx').on(t.officerId, t.scheduledAt),
    index('visits_property_idx').on(t.propertyId),
    index('visits_status_idx').on(t.status),
  ],
);

export const visitGeneral = pgTable(
  'visit_general',
  {
    id: uuid().primaryKey(),
    visitId: uuid().notNull().references(() => visits.id, { onDelete: 'cascade' }),
    fieldCode: text().notNull(),
    value: text().notNull().default(''),
    ...syncColumns(),
  },
  (t) => [uniqueIndex('visit_general_visit_field_uq').on(t.visitId, t.fieldCode)],
);

export const appliances = pgTable(
  'appliances',
  {
    id: uuid().primaryKey(),
    visitId: uuid().notNull().references(() => visits.id, { onDelete: 'cascade' }),
    applianceCode: text().notNull(),
    make: text(),
    model: text(),
    serial: text(),
    ...syncColumns(),
  },
  (t) => [uniqueIndex('appliances_visit_code_uq').on(t.visitId, t.applianceCode)],
);

export const meterReadings = pgTable(
  'meter_readings',
  {
    id: uuid().primaryKey(),
    visitId: uuid().notNull().references(() => visits.id, { onDelete: 'cascade' }),
    service: text().notNull(),
    location: text(),
    readingIn: text(),
    readingOut: text(),
    photoId: uuid(), // FK photos(id) DEFERRABLE — custom migration
    ...syncColumns(),
  },
  (t) => [uniqueIndex('meter_readings_visit_service_uq').on(t.visitId, t.service)],
);

export const roomInstances = pgTable(
  'room_instances',
  {
    id: uuid().primaryKey(),
    visitId: uuid().notNull().references(() => visits.id, { onDelete: 'cascade' }),
    roomCode: text().notNull(),
    label: text().notNull(),
    sortOrder: integer().notNull(),
    present: boolean().notNull().default(true),
    widePhotoId: uuid(), // FK photos(id) DEFERRABLE — custom migration
    ...syncColumns(),
  },
  (t) => [index('room_instances_visit_sort_idx').on(t.visitId, t.sortOrder)],
);

export const itemRecords = pgTable(
  'item_records',
  {
    id: uuid().primaryKey(),
    visitId: uuid().notNull().references(() => visits.id, { onDelete: 'cascade' }),
    roomInstanceId: uuid().references(() => roomInstances.id, { onDelete: 'cascade' }), // null => MISCELLANEOUS
    itemCode: text(),
    label: text().notNull(),
    sortOrder: integer().notNull(),
    qty: integer(),
    description: text(),
    condition: conditionsEnum(),
    naReason: text(),
    comment: text(),
    dilapidation: text(),
    ...syncColumns(),
  },
  (t) => [
    index('item_records_visit_idx').on(t.visitId),
    index('item_records_room_sort_idx').on(t.roomInstanceId, t.sortOrder),
  ],
);

export const photos = pgTable(
  'photos',
  {
    id: uuid().primaryKey(),
    visitId: uuid().notNull().references(() => visits.id, { onDelete: 'cascade' }),
    roomInstanceId: uuid().references(() => roomInstances.id, { onDelete: 'set null' }),
    itemRecordId: uuid().references(() => itemRecords.id, { onDelete: 'set null' }),
    ref: text(),
    capturedAt: tstz().notNull(),
    lat: doublePrecision(),
    lng: doublePrecision(),
    stampText: text().notNull(),
    sha256: text().notNull(),
    bytes: integer().notNull(),
    width: integer().notNull(),
    height: integer().notNull(),
    uploaded: boolean().notNull().default(false),
    storageKey: text().notNull(),
    retentionUntil: date({ mode: 'string' }),
    ...syncColumns(),
  },
  (t) => [
    index('photos_visit_idx').on(t.visitId),
    index('photos_item_record_idx').on(t.itemRecordId),
    uniqueIndex('photos_visit_ref_uq').on(t.visitId, t.ref).where(sql`ref is not null`),
  ],
);

export const additionalNotes = pgTable(
  'additional_notes',
  {
    id: uuid().primaryKey(),
    visitId: uuid().notNull().references(() => visits.id, { onDelete: 'cascade' }),
    noteDate: date({ mode: 'string' }).notNull(),
    note: text().notNull(),
    addedBy: text().notNull(),
    signed: text(),
    ...syncColumns(),
  },
  (t) => [index('additional_notes_visit_idx').on(t.visitId)],
);

// ── Issue and sign-off (server-created) ──────────────────────────────────────
export const reports = pgTable('reports', {
  id: uuid().primaryKey(),
  visitId: uuid().notNull().unique().references(() => visits.id),
  reportNumber: text().notNull().unique(),
  snapshot: jsonb().notNull(),
  pdfStorageKey: text(),
  sha256: text(),
  pdfReady: boolean().notNull().default(false),
  issuedAt: tstz().notNull().defaultNow(),
  issuedBy: uuid().notNull().references(() => users.id),
});

/** Device-writable (sync entity 'signature') until the visit is issued; captured BEFORE issue. */
export const signatures = pgTable(
  'signatures',
  {
    id: uuid().primaryKey(),
    visitId: uuid().notNull().references(() => visits.id, { onDelete: 'cascade' }),
    reportId: uuid().references(() => reports.id), // set by the issue transaction
    role: signatureRolesEnum().notNull(),
    name: text().notNull(),
    method: signatureMethodsEnum().notNull(),
    signedAt: tstz().notNull().defaultNow(),
    contentSha256: text(), // visitContentHash() of what was signed
    reportSha256: text(),
    imageStorageKey: text(), // hasImage = image_storage_key is not null
    ip: inet(),
    userAgent: text(),
    ...syncColumns(),
  },
  (t) => [
    index('signatures_visit_idx').on(t.visitId),
    uniqueIndex('signatures_visit_role_on_device_uq')
      .on(t.visitId, t.role)
      .where(sql`method = 'on_device' and deleted_at is null`),
  ],
);

export const reportNumberSeq = pgTable('report_number_seq', {
  year: integer().primaryKey(),
  last: integer().notNull().default(0),
});

// ── Sync, audit, auth, jobs ──────────────────────────────────────────────────
export const processedMutations = pgTable('processed_mutations', {
  mutationId: uuid().primaryKey(),
  deviceId: text().notNull(),
  userId: uuid().references(() => users.id),
  receivedAt: tstz().notNull().defaultNow(),
  status: text().notNull(),
});

export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    entity: text().notNull(),
    entityId: uuid().notNull(),
    field: text().notNull(),
    oldValue: jsonb(),
    newValue: jsonb(),
    actor: uuid().references(() => users.id),
    deviceId: text(),
    clientUpdatedAt: tstz(),
    at: tstz().notNull().defaultNow(),
  },
  (t) => [
    index('audit_events_entity_field_client_idx').on(t.entityId, t.field, t.clientUpdatedAt.desc()),
    index('audit_events_at_idx').on(t.at),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: text().primaryKey(), // random 32 bytes, base64url
    userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    expiresAt: tstz().notNull(),
    lastSeenAt: tstz().notNull().defaultNow(),
    userAgent: text(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const jobs = pgTable(
  'jobs',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    kind: text().notNull(),
    payload: jsonb().notNull().default({}),
    status: text().$type<JobStatus>().notNull().default('queued'),
    attempts: integer().notNull().default(0),
    runAfter: tstz().notNull().defaultNow(),
    lastError: text(),
    lockedAt: tstz(), // addition: when the current attempt was claimed (stuck-job recovery)
    createdAt: createdAt(),
  },
  (t) => [
    check('jobs_status_chk', sql`${t.status} in ('queued','running','done','failed')`),
    index('jobs_status_run_after_idx').on(t.status, t.runAfter),
  ],
);

// ── Signing links (packages/shared/src/signing.ts) — server-created, after issue ─────
/** Secure expiring link for an absent landlord/tenant to sign the ISSUED report or dispute items. */
export const signingLinks = pgTable(
  'signing_links',
  {
    id: uuid().primaryKey(),
    reportId: uuid().notNull().references(() => reports.id),
    role: signatureRolesEnum().notNull(), // LINK_SIGNER_ROLES only (check below)
    tokenHash: text().notNull().unique('signing_links_token_hash_uq'), // sha256 (base64url) of the token; raw token never stored
    recipientName: text(),
    recipientEmail: text(),
    createdBy: uuid().notNull().references(() => users.id),
    createdAt: createdAt(),
    expiresAt: tstz().notNull(),
    openedAt: tstz(),
    signedAt: tstz(),
    revokedAt: tstz(),
    signatureId: uuid().references(() => signatures.id),
  },
  (t) => [
    check('signing_links_role_chk', sql`${t.role} in ('landlord_agent','tenant_check_in','tenant_check_out')`),
    index('signing_links_report_idx').on(t.reportId),
  ],
);

/** An item disputed by a link signer. */
export const disputes = pgTable(
  'disputes',
  {
    id: uuid().primaryKey(),
    reportId: uuid().notNull().references(() => reports.id),
    signingLinkId: uuid().notNull().references(() => signingLinks.id),
    itemRecordId: uuid().notNull().references(() => itemRecords.id),
    comment: text().notNull(),
    createdAt: createdAt(),
    resolvedAt: tstz(),
    resolvedBy: uuid().references(() => users.id),
  },
  (t) => [index('disputes_report_idx').on(t.reportId)],
);
