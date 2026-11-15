/**
 * Shared enumerations. These string values are stored in the database
 * (as Postgres enums / text checks) and sent over the API — do not rename.
 */

export const ROLES = ['officer', 'manager', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/** Condition grades: template G/F/P + confirmed U and NA (decision 1). */
export const CONDITIONS = ['G', 'F', 'P', 'U', 'NA'] as const;
export type Condition = (typeof CONDITIONS)[number];

/** Grades that count as a defect: need a comment and at least one photo. */
export const DEFECT_CONDITIONS: readonly Condition[] = ['F', 'P', 'U'];

export const VISIT_TYPES = ['check_in', 'check_out', 'interim'] as const;
export type VisitType = (typeof VISIT_TYPES)[number];

export const VISIT_STATUSES = ['scheduled', 'in_progress', 'completed', 'issued', 'cancelled'] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const TENANCY_STATUSES = ['pending', 'active', 'ended'] as const;
export type TenancyStatus = (typeof TENANCY_STATUSES)[number];

export const FORM_VERSION_STATUSES = ['draft', 'published', 'retired'] as const;
export type FormVersionStatus = (typeof FORM_VERSION_STATUSES)[number];

/** Decision 4: four signature roles. */
export const SIGNATURE_ROLES = ['landlord_agent', 'officer', 'tenant_check_in', 'tenant_check_out'] as const;
export type SignatureRole = (typeof SIGNATURE_ROLES)[number];

export const SIGNATURE_METHODS = ['on_device', 'link', 'wet', 'officer_only'] as const;
export type SignatureMethod = (typeof SIGNATURE_METHODS)[number];

/** All four schemes use the same form (decision 5). Display name drives cover + declaration (decision 6). */
export const SCHEMES = [
  { code: 'PLS', name: 'Private Leasing Scheme' },
  { code: 'NP', name: 'Nightly Paid' },
  { code: 'TF', name: 'Tenant Finder' },
  { code: 'PRSO', name: 'Private Rented Sector Offer' },
] as const;
export type SchemeCode = (typeof SCHEMES)[number]['code'];
export const SCHEME_CODES = SCHEMES.map((s) => s.code) as [SchemeCode, ...SchemeCode[]];

/** Entities that the device can create/update offline and push via /api/sync/push. */
export const SYNC_ENTITIES = [
  'visit',
  'visit_general',
  'appliance',
  'meter_reading',
  'room_instance',
  'item_record',
  'photo',
  'additional_note',
] as const;
export type SyncEntity = (typeof SYNC_ENTITIES)[number];

export const PROPERTY_TYPES = [
  'Studio flat',
  '1-bed flat',
  '2-bed flat',
  '3-bed flat',
  '2-bed house',
  '3-bed house',
  '4-bed house',
  'Other',
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];
