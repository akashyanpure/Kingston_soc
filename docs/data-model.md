# Data model (approved 2026-11-15)

PostgreSQL 17. Source of truth for the *form* is `SOC TEMPLATE (PLS).docx` → `packages/shared/src/form.ts`.
This document is the contract between `packages/db` (schema), `apps/api` (queries) and `apps/web` (device store).

## Conventions
- **Column mapping:** every field of every entity schema in `packages/shared/src/schemas.ts` is a column of the same name in **snake_case** (`roomInstanceId` → `room_instance_id`). Drizzle maps camelCase ↔ snake_case (`casing: 'snake_case'`). The API returns the camelCase shapes exactly as the zod schemas define them.
- **IDs:** `uuid` primary keys. Device-creatable rows (visit, visit_general, appliance, meter_reading, room_instance, item_record, photo, additional_note) receive their id from the device (UUIDv7). Server-created rows default to `uuidv7()` (built into PG 18; on PG 17 generate in the app with the `uuidv7` npm package).
- **Times:** `timestamptz`. Dates: `date`. Enums: Postgres enums named after `packages/shared/src/enums.ts` constants, same string values.
- **Sync columns** on device-writable tables: `updated_at timestamptz not null`, `updated_by uuid null references users`. Also `created_at timestamptz not null default now()` and `deleted_at timestamptz null` (soft delete — a sync `delete` sets it).
- No `organisation_id` (Kingston-only; decided 2026-11-15).

## Tables
### Reference
| Table | Columns (beyond schema fields) | Constraints / indexes |
|---|---|---|
| `users` | `password_hash text null` (argon2id; null once SSO-only), `created_at` | unique lower(email) |
| `schemes` | code is PK (`PLS`,`NP`,`TF`,`PRSO`) | — |
| `form_versions` | `definition jsonb not null`, `created_at` | unique(version); at most one `published` (partial unique index) |
| `description_phrases` | `created_at` | index(item_code, sort_order) |

### Properties and people
| Table | Notes |
|---|---|
| `landlords` | — |
| `properties` | unique(uprn) where not null; index on lower(postcode); trigram index on address_line1 (pg_trgm) for search |
| `tenancies` | FK property; index(property_id) |

### Visit (device-writable)
| Table | Notes |
|---|---|
| `visits` | FKs property, tenancy, scheme, form_version, officer(users). unique(report_number). index(officer_id, scheduled_at), index(property_id), index(status). |
| `visit_general` | unique(visit_id, field_code) |
| `appliances` | unique(visit_id, appliance_code) |
| `meter_readings` | unique(visit_id, service); photo_id FK photos (deferrable) |
| `room_instances` | index(visit_id, sort_order); wide_photo_id FK photos (deferrable) |
| `item_records` | index(visit_id); index(room_instance_id, sort_order); condition enum nullable; `room_instance_id` null = MISCELLANEOUS |
| `photos` | `storage_key text not null` (server-assigned, e.g. `photos/{visitId}/{id}.jpg`), `retention_until date null`. index(visit_id); index(item_record_id). unique(visit_id, ref) where ref not null |
| `additional_notes` | index(visit_id). **Append-only**: trigger blocks UPDATE/DELETE once the visit is issued |

### Issue and sign-off (server-created)
| Table | Columns | Notes |
|---|---|---|
| `reports` | id, visit_id (unique), report_number, `snapshot jsonb not null` (VisitBundle + FormDefinition + scheme name at issue), `pdf_storage_key text null`, sha256 null, pdf_ready bool, issued_at, issued_by | **Immutable**: trigger rejects UPDATE except setting pdf_storage_key/sha256/pdf_ready from null once; rejects DELETE |
| `signatures` | + `image_storage_key text null`, `ip inet null`, `user_agent text null` | unique(report_id, role) |
| `report_number_seq` | per-year counter: (year int PK, last int) | `SOC-YYYY-NNNN`, allocated in the issue transaction |

### Visit immutability
Trigger on all device-writable visit tables: reject INSERT/UPDATE/DELETE when the parent visit's `status = 'issued'` (additional_notes excepted for INSERT — post-issue notes go through `POST /reports/:id/notes`).

### Sync, audit, auth, jobs
| Table | Columns | Notes |
|---|---|---|
| `processed_mutations` | mutation_id uuid PK, device_id text, user_id, received_at, status text | idempotency |
| `audit_events` | id bigint identity PK, entity text, entity_id uuid, field text, old_value jsonb, new_value jsonb, actor uuid, device_id text null, at timestamptz | index(entity, entity_id); index(at) — candidate for yearly partitioning |
| `sessions` | id text PK (random 32 bytes, base64url), user_id, created_at, expires_at, last_seen_at, user_agent | index(user_id); sessions last 14 days, sliding (offline days) |
| `jobs` | id bigint identity, kind text ('render_pdf'), payload jsonb, status ('queued','running','done','failed'), attempts int, run_after timestamptz, last_error text, created_at | Postgres queue: `SELECT … FOR UPDATE SKIP LOCKED` |

## Visit creation
`POST /visits` creates the visit and, from the current published form definition, **one room_instance per template room** (present = code ∈ presentRoomCodes) and **one item_record per item of every present room** (condition null), plus visit_general rows with defaults (WINDOWS, HEATING), 3 appliance rows and 4 meter rows. Not-present rooms get no item rows until marked present (the device creates them then).

## Scalability
~5,200 visits/yr → ~1.4 M item_records/yr, ~210 k photo rows/yr (files ~60 GB/yr on disk/object storage, never in the DB), ~1 GB/yr of report snapshots. 7-year retention ≈ 10 M item rows: routine for indexed Postgres. 10× growth still fits one instance; partition `item_records`/`audit_events` by year if ever needed. Bottlenecks are PDF rendering (job queue) and photo bytes (object storage), not the database.
