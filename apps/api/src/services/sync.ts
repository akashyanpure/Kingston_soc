/**
 * POST /sync/push (packages/shared/src/sync.ts, docs/data-model.md).
 *
 * Each mutation runs in its own transaction:
 *   1. INSERT processed_mutations … ON CONFLICT DO NOTHING — no row ⇒ 'duplicate' (idempotent retries).
 *   2. Visit access (officer: own visits; manager/admin: all). Issued visit ⇒ 'rejected'.
 *   3. Per-field last-write-wins: a field is applied unless audit_events already holds a newer
 *      client_updated_at for (entity_id, field). Every applied field writes an audit_event.
 *   4. The merged row is validated with the shared zod schema before it is written.
 *   5. A room_instance that becomes present=true gets its template items (ensureRoomItems).
 * Rejected mutations are not recorded, so a retry is re-evaluated (e.g. once a parent row exists).
 * A mutation that references a row not yet pushed (room/item/photo) is retried once at the
 * end of the batch, so the device's push order does not have to be perfect.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import {
  additionalNotes, appliances, auditEvents, ensureRoomItems, isImmutableError, itemRecords, meterReadings, pgErrorCode,
  photos, processedMutations, roomInstances, serializeRow, visitGeneral, visits,
} from '@soc/db';
import type { Db } from '@soc/db';
import {
  AdditionalNote, Appliance, ItemRecord, MeterReading, Photo, RoomInstance, Visit, VisitGeneral,
} from '@soc/shared';
import type { Mutation, MutationResult, PushRequest, SyncEntity, User } from '@soc/shared';
import type { z } from 'zod';
import { isManager } from '../auth/index.js';
import { photoKey } from '../adapters/storage.js';

interface EntitySpec {
  table: PgTable & { id: AnyPgColumn; updatedAt: AnyPgColumn; deletedAt: AnyPgColumn };
  schema: z.ZodObject;
  /** Fields the device may never write. */
  serverOnly: string[];
  /** Fields that may be set on create but never changed afterwards. */
  createOnly: string[];
  /** Same-visit references to check: field → referenced entity. */
  refs: Record<string, 'room_instance' | 'item_record' | 'photo'>;
}

const BASE_SERVER_ONLY = ['id', 'updatedAt', 'updatedBy'];

const SPECS: Record<SyncEntity, EntitySpec> = {
  visit: {
    table: visits as never, schema: Visit,
    serverOnly: [...BASE_SERVER_ONLY, 'officerId', 'formVersionId', 'reportNumber', 'propertyId'],
    createOnly: [], refs: {},
  },
  visit_general: { table: visitGeneral as never, schema: VisitGeneral, serverOnly: BASE_SERVER_ONLY, createOnly: ['visitId', 'fieldCode'], refs: {} },
  appliance: { table: appliances as never, schema: Appliance, serverOnly: BASE_SERVER_ONLY, createOnly: ['visitId', 'applianceCode'], refs: {} },
  meter_reading: { table: meterReadings as never, schema: MeterReading, serverOnly: BASE_SERVER_ONLY, createOnly: ['visitId', 'service'], refs: { photoId: 'photo' } },
  room_instance: { table: roomInstances as never, schema: RoomInstance, serverOnly: BASE_SERVER_ONLY, createOnly: ['visitId', 'roomCode'], refs: { widePhotoId: 'photo' } },
  item_record: { table: itemRecords as never, schema: ItemRecord, serverOnly: BASE_SERVER_ONLY, createOnly: ['visitId'], refs: { roomInstanceId: 'room_instance' } },
  photo: {
    table: photos as never, schema: Photo,
    serverOnly: [...BASE_SERVER_ONLY, 'ref', 'uploaded'],
    // A photograph's content and stamp are immutable once synced (soc-domain-model).
    createOnly: ['visitId', 'capturedAt', 'lat', 'lng', 'stampText', 'sha256', 'bytes', 'width', 'height'],
    refs: { roomInstanceId: 'room_instance', itemRecordId: 'item_record' },
  },
  additional_note: { table: additionalNotes as never, schema: AdditionalNote, serverOnly: BASE_SERVER_ONLY, createOnly: ['visitId'], refs: {} },
};

const REF_TABLES = { room_instance: roomInstances, item_record: itemRecords, photo: photos } as const;
const TIMESTAMP_FIELDS = new Set(['scheduledAt', 'startedAt', 'completedAt', 'capturedAt', 'deletedAt', 'updatedAt']);

class Reject extends Error {}
class MissingRef extends Error {}

const toDb = (field: string, v: unknown) => (TIMESTAMP_FIELDS.has(field) && typeof v === 'string' ? new Date(v) : v);
const toJson = (v: unknown) => (v instanceof Date ? v.toISOString() : v === undefined ? null : v);
const same = (a: unknown, b: unknown) => JSON.stringify(toJson(a)) === JSON.stringify(toJson(b));

/** Pick the schema's fields out of a DB row (API shape). */
function apiShape(spec: EntitySpec, row: Record<string, unknown>): Record<string, unknown> {
  const s = serializeRow(row) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(spec.schema.shape)) out[k] = s[k] ?? null;
  return out;
}

export async function pushMutations(db: Db, user: User, req: PushRequest): Promise<MutationResult[]> {
  const results = new Map<string, MutationResult>();
  const deferred: Mutation[] = [];
  for (const m of req.mutations) {
    const r = await applyOne(db, user, req.deviceId, m, false);
    if (r === 'deferred') deferred.push(m);
    else results.set(m.mutationId, r);
  }
  for (const m of deferred) results.set(m.mutationId, (await applyOne(db, user, req.deviceId, m, true)) as MutationResult);
  return req.mutations.map((m) => results.get(m.mutationId)!);
}

async function applyOne(db: Db, user: User, deviceId: string, m: Mutation, final: boolean): Promise<MutationResult | 'deferred'> {
  try {
    return await db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Db;
      const [claimed] = await tx
        .insert(processedMutations)
        .values({ mutationId: m.mutationId, deviceId, userId: user.id, status: 'applied' })
        .onConflictDoNothing()
        .returning({ id: processedMutations.mutationId });
      if (!claimed) return { mutationId: m.mutationId, status: 'duplicate' as const };
      await applyMutation(tx, user, deviceId, m);
      return { mutationId: m.mutationId, status: 'applied' as const };
    });
  } catch (err) {
    if (err instanceof MissingRef && !final) return 'deferred';
    let error: string;
    if (err instanceof Reject || err instanceof MissingRef) error = err.message;
    else if (isImmutableError(err)) error = 'VISIT_ISSUED: the visit has been issued and cannot be changed.';
    else if (pgErrorCode(err) === '23505') error = 'CONFLICT: a row with these unique values already exists.';
    else if (pgErrorCode(err) === '23503') error = 'MISSING_REFERENCE: a referenced row does not exist.';
    else throw err;
    return { mutationId: m.mutationId, status: 'rejected', error };
  }
}

async function applyMutation(tx: Db, user: User, deviceId: string, m: Mutation): Promise<void> {
  const spec = SPECS[m.entity];
  const t = spec.table as unknown as PgTable & { id: AnyPgColumn };
  const [existingRaw] = await tx.select().from(t).where(eq(t.id, m.id)).limit(1).for('update');
  const existing = existingRaw as Record<string, unknown> | undefined;

  // ── Which visit does this touch? ──
  let visitId: string;
  if (m.entity === 'visit') {
    if (!existing) throw new Reject('VISIT_NOT_FOUND: create visits with POST /api/visits.');
    visitId = m.id;
  } else {
    const fromData = typeof m.data.visitId === 'string' ? m.data.visitId : undefined;
    if (existing) {
      visitId = existing.visitId as string;
      if (fromData && fromData !== visitId) throw new Reject('INVALID: visitId cannot change.');
    } else {
      if (!fromData) throw new Reject('INVALID: visitId is required.');
      visitId = fromData;
    }
  }
  const [visit] = await tx.select().from(visits).where(eq(visits.id, visitId)).limit(1).for('update');
  if (!visit || (visit.deletedAt && m.entity !== 'visit')) throw new Reject('VISIT_NOT_FOUND: visit does not exist.');
  if (!isManager(user) && visit.officerId !== user.id) throw new Reject('FORBIDDEN: this visit is assigned to another officer.');
  if (visit.status === 'issued') throw new Reject('VISIT_ISSUED: the visit has been issued and cannot be changed.');

  const clientAt = new Date(m.clientUpdatedAt);

  // ── Requested field changes ──
  let changes: Record<string, unknown>;
  if (m.op === 'delete') {
    changes = { deletedAt: m.clientUpdatedAt };
    if (!existing) throw new Reject('NOT_FOUND: nothing to delete.');
  } else {
    const allowed = new Set(Object.keys(spec.schema.shape));
    changes = {};
    for (const [k, v] of Object.entries(m.data)) {
      if (k === 'visitId' && m.entity !== 'visit') continue; // handled above
      if (k === 'deletedAt' && m.entity === 'photo') { changes[k] = v; continue; }
      if (!allowed.has(k)) throw new Reject(`INVALID: unknown field '${k}' for ${m.entity}.`);
      if (spec.serverOnly.includes(k)) {
        if (existing && same(apiShape(spec, existing)[k], v)) continue; // echo of server value: harmless
        throw new Reject(`INVALID: '${k}' is set by the server.`);
      }
      if (existing && spec.createOnly.includes(k) && !same(apiShape(spec, existing)[k], v)) throw new Reject(`INVALID: '${k}' cannot be changed once created.`);
      changes[k] = v;
    }
    if (m.entity === 'visit' && changes.status === 'issued') throw new Reject('INVALID: visits are issued with POST /api/visits/:id/issue.');
  }

  // ── Same-visit references (deferred once if the row is not pushed yet) ──
  for (const [field, target] of Object.entries(spec.refs)) {
    const v = changes[field];
    if (typeof v !== 'string') continue;
    const rt = REF_TABLES[target];
    const [ref] = await tx.select({ visitId: rt.visitId }).from(rt).where(eq(rt.id, v)).limit(1);
    if (!ref) throw new MissingRef(`MISSING_REFERENCE: ${field} ${v} not found.`);
    if (ref.visitId !== visitId) throw new Reject(`INVALID: ${field} belongs to another visit.`);
  }

  // ── Per-field last-write-wins ──
  let applied: Record<string, unknown> = changes;
  if (existing && Object.keys(changes).length) {
    const newer = await tx
      .select({ field: auditEvents.field })
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, m.id), inArray(auditEvents.field, Object.keys(changes)), sql`${auditEvents.clientUpdatedAt} > ${clientAt}`))
      .groupBy(auditEvents.field);
    const lost = new Set(newer.map((n) => n.field));
    applied = Object.fromEntries(Object.entries(changes).filter(([k]) => !lost.has(k)));
  }

  // ── Merge + validate with the shared schema ──
  const base = existing
    ? apiShape(spec, existing)
    : Object.fromEntries(Object.keys(spec.schema.shape).map((k) => [k, null]));
  const merged: Record<string, unknown> = { ...base, ...applied, id: m.id, updatedBy: user.id };
  if (m.entity !== 'visit') merged.visitId = visitId;
  const prevUpdated = existing ? (existing.updatedAt as Date) : null;
  merged.updatedAt = prevUpdated && prevUpdated > clientAt ? prevUpdated.toISOString() : clientAt.toISOString();
  if (!existing && m.entity === 'photo') Object.assign(merged, { ref: null, uploaded: false, deletedAt: merged.deletedAt ?? null });
  if (!existing && m.entity === 'room_instance' && merged.present === null) merged.present = true;
  const { deletedAt: _deleted, ...validatable } = merged;
  const check = spec.schema.safeParse(m.entity === 'photo' ? merged : validatable);
  if (!check.success) {
    throw new Reject(`INVALID: ${check.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  if (existing && Object.keys(applied).length === 0) return; // everything lost to newer writes

  // ── Write ──
  const dbValues: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(applied)) dbValues[k] = toDb(k, v);
  dbValues.updatedAt = new Date(merged.updatedAt as string);
  dbValues.updatedBy = user.id;
  if (existing) {
    await tx.update(t).set(dbValues).where(eq(t.id, m.id));
  } else {
    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(merged)) row[k] = toDb(k, v);
    if (m.entity === 'photo') row.storageKey = photoKey(visitId, m.id);
    await tx.insert(t).values(row as never);
  }

  // ── Audit (one row per applied field) ──
  const old = existing ? apiShape(spec, existing) : {};
  const events = Object.entries(applied)
    .map(([field, v]) => ({
      entity: m.entity, entityId: m.id, field, oldValue: existing ? toJson(old[field] ?? (field === 'deletedAt' ? existing.deletedAt : null)) : null,
      newValue: toJson(v), actor: user.id, deviceId, clientUpdatedAt: clientAt,
    }));
  if (events.length) await tx.insert(auditEvents).values(events as never);

  // ── Room became present ⇒ template items ──
  if (m.entity === 'room_instance' && applied.present === true && (!existing || existing.present !== true)) {
    await ensureRoomItems(tx, m.id, { updatedBy: user.id });
  }
}

