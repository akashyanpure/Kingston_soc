import { and, asc, desc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import {
  VisitBundle, VisitSummary, Visit,
  type CreateVisitRequest, type FormDefinition, type VisitListQuery,
} from '@soc/shared';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Db } from '../client.js';
import {
  additionalNotes, appliances, formVersions, itemRecords, landlords, meterReadings, photos,
  properties, reports, roomInstances, signatures, tenancies, users, visitGeneral, visits,
} from '../schema.js';
import { serializeRow } from './serialize.js';

/** Gap between consecutive sort_order values, so the device can insert rows in between. */
export const SORT_STEP = 10;

export interface FormVersionRef {
  id: string;
  definition: FormDefinition | unknown;
}

/** The current published form version (null if none). */
export async function getPublishedFormVersion(db: Db) {
  const [row] = await db.select().from(formVersions).where(eq(formVersions.status, 'published')).limit(1);
  return row ?? null;
}

function asDefinition(def: unknown): FormDefinition {
  const d = def as FormDefinition;
  if (!d || !Array.isArray(d.rooms) || !Array.isArray(d.general)) throw new Error('form version definition is not a FormDefinition');
  return d;
}

export class UnknownRoomCodeError extends Error {
  constructor(public readonly codes: string[]) {
    super(`unknown room code(s): ${codes.join(', ')}`);
    this.name = 'UnknownRoomCodeError';
  }
}

/**
 * POST /visits: create the visit plus, from the form definition, one room_instance per template
 * room (present = code ∈ presentRoomCodes), one item_record per item of every present room
 * (condition null), visit_general rows (every general field, value = defaultValue ?? ''),
 * one appliance row per appliance and one meter row per meter. Call inside a transaction.
 * Returns the created visit in API shape.
 */
export async function createVisitFromForm(
  tx: Db,
  req: CreateVisitRequest,
  officerId: string,
  formVersion: FormVersionRef,
  opts: { now?: Date } = {},
): Promise<Visit> {
  const def = asDefinition(formVersion.definition);
  const known = new Set(def.rooms.map((r) => r.code));
  const unknown = req.presentRoomCodes.filter((c) => !known.has(c));
  if (unknown.length) throw new UnknownRoomCodeError(unknown);
  const present = new Set(req.presentRoomCodes);
  const now = opts.now ?? new Date();
  const sync = { updatedAt: now, updatedBy: officerId };

  const [visit] = await tx
    .insert(visits)
    .values({
      id: req.id,
      propertyId: req.propertyId,
      tenancyId: req.tenancyId ?? null,
      schemeCode: req.schemeCode,
      visitType: req.visitType,
      formVersionId: formVersion.id,
      officerId,
      status: 'scheduled',
      scheduledAt: req.scheduledAt ? new Date(req.scheduledAt) : null,
      ...sync,
    })
    .returning();

  const roomRows = def.rooms.map((r, i) => ({
    id: uuidv7(), visitId: req.id, roomCode: r.code, label: r.label,
    sortOrder: (i + 1) * SORT_STEP, present: present.has(r.code), widePhotoId: null, ...sync,
  }));
  await tx.insert(roomInstances).values(roomRows);

  const itemRows = roomRows.flatMap((room, i) =>
    room.present ? itemRowsFor(req.id, room.id, def.rooms[i]!.items, sync) : [],
  );
  for (let i = 0; i < itemRows.length; i += 500) await tx.insert(itemRecords).values(itemRows.slice(i, i + 500));

  await tx.insert(visitGeneral).values(
    def.general.map((g) => ({ id: uuidv7(), visitId: req.id, fieldCode: g.code, value: g.defaultValue ?? '', ...sync })),
  );
  await tx.insert(appliances).values(
    def.appliances.map((a) => ({ id: uuidv7(), visitId: req.id, applianceCode: a.code, make: null, model: null, serial: null, ...sync })),
  );
  await tx.insert(meterReadings).values(
    def.meters.map((m) => ({ id: uuidv7(), visitId: req.id, service: m.code, location: null, readingIn: null, readingOut: null, photoId: null, ...sync })),
  );
  return Visit.parse(serializeRow(visit!));
}

function itemRowsFor(
  visitId: string,
  roomInstanceId: string,
  items: { code: string; label: string }[],
  sync: { updatedAt: Date; updatedBy: string | null },
) {
  return items.map((it, j) => ({
    id: uuidv7(), visitId, roomInstanceId, itemCode: it.code, label: it.label, sortOrder: (j + 1) * SORT_STEP,
    qty: null, description: null, condition: null, naReason: null, comment: null, dilapidation: null, ...sync,
  }));
}

/**
 * Create the template item rows for a room instance that has none yet for those item codes
 * (e.g. a room later marked present on the server). Idempotent: existing (non-deleted) item codes
 * are skipped. Returns the number of rows inserted.
 */
export async function ensureRoomItems(tx: Db, roomInstanceId: string, opts: { updatedBy?: string | null; now?: Date } = {}): Promise<number> {
  const [room] = await tx
    .select({ id: roomInstances.id, visitId: roomInstances.visitId, roomCode: roomInstances.roomCode, definition: formVersions.definition })
    .from(roomInstances)
    .innerJoin(visits, eq(visits.id, roomInstances.visitId))
    .innerJoin(formVersions, eq(formVersions.id, visits.formVersionId))
    .where(eq(roomInstances.id, roomInstanceId));
  if (!room) throw new Error(`room instance ${roomInstanceId} not found`);
  const def = asDefinition(room.definition);
  const template = def.rooms.find((r) => r.code === room.roomCode);
  if (!template) return 0;
  const existing = await tx
    .select({ itemCode: itemRecords.itemCode })
    .from(itemRecords)
    .where(and(eq(itemRecords.roomInstanceId, roomInstanceId), isNull(itemRecords.deletedAt)));
  const have = new Set(existing.map((e) => e.itemCode));
  const sync = { updatedAt: opts.now ?? new Date(), updatedBy: opts.updatedBy ?? null };
  const rows = itemRowsFor(room.visitId, room.id, template.items, sync).filter((r) => !have.has(r.itemCode));
  if (rows.length) await tx.insert(itemRecords).values(rows);
  return rows.length;
}

/**
 * Everything the device needs for one visit (GET /visits/:id, POST /visits response).
 * Soft-deleted rows are excluded. Returns null if the visit does not exist or is soft-deleted.
 * The result has been validated with the shared `VisitBundle` zod schema.
 */
export async function loadVisitBundle(db: Db, visitId: string): Promise<VisitBundle | null> {
  const [visit] = await db.select().from(visits).where(and(eq(visits.id, visitId), isNull(visits.deletedAt)));
  if (!visit) return null;
  const live = (t: { visitId: AnyPgColumn; deletedAt: AnyPgColumn }) =>
    and(eq(t.visitId, visitId), isNull(t.deletedAt));

  const [[property], tenancy, general, appls, meters, rooms, items, pics, notes, [report]] = await Promise.all([
    db.select().from(properties).where(eq(properties.id, visit.propertyId)),
    visit.tenancyId ? db.select().from(tenancies).where(eq(tenancies.id, visit.tenancyId)) : Promise.resolve([]),
    db.select().from(visitGeneral).where(live(visitGeneral)).orderBy(asc(visitGeneral.createdAt), asc(visitGeneral.id)),
    db.select().from(appliances).where(live(appliances)).orderBy(asc(appliances.createdAt), asc(appliances.id)),
    db.select().from(meterReadings).where(live(meterReadings)).orderBy(asc(meterReadings.createdAt), asc(meterReadings.id)),
    db.select().from(roomInstances).where(live(roomInstances)).orderBy(asc(roomInstances.sortOrder), asc(roomInstances.id)),
    db.select().from(itemRecords).where(live(itemRecords)).orderBy(asc(itemRecords.sortOrder), asc(itemRecords.id)),
    db.select().from(photos).where(live(photos)).orderBy(asc(photos.capturedAt), asc(photos.id)),
    db.select().from(additionalNotes).where(live(additionalNotes)).orderBy(asc(additionalNotes.noteDate), asc(additionalNotes.createdAt)),
    db.select({
      id: reports.id, visitId: reports.visitId, reportNumber: reports.reportNumber, sha256: reports.sha256,
      pdfReady: reports.pdfReady, issuedAt: reports.issuedAt, issuedBy: reports.issuedBy,
    }).from(reports).where(eq(reports.visitId, visitId)),
  ]);
  if (!property) throw new Error(`property ${visit.propertyId} missing for visit ${visitId}`);
  const [landlord] = property.landlordId ? await db.select().from(landlords).where(eq(landlords.id, property.landlordId)) : [];
  const sigs = report
    ? await db.select().from(signatures).where(eq(signatures.reportId, report.id)).orderBy(asc(signatures.signedAt))
    : [];

  return VisitBundle.parse({
    visit: serializeRow(visit),
    property: serializeRow(property),
    landlord: landlord ? serializeRow(landlord) : null,
    tenancy: tenancy[0] ? serializeRow(tenancy[0]) : null,
    general: general.map(serializeRow),
    appliances: appls.map(serializeRow),
    meters: meters.map(serializeRow),
    rooms: rooms.map(serializeRow),
    items: items.map(serializeRow),
    photos: pics.map(serializeRow),
    notes: notes.map(serializeRow),
    report: report ? serializeRow(report) : null,
    signatures: sigs.map(serializeRow),
  });
}

/** Filter for listVisits: VisitListQuery plus optional property scope. from/to are Europe/London dates on scheduled_at (inclusive). */
export type ListVisitsFilter = VisitListQuery & { propertyId?: string; limit?: number };

/** Rows shaped like shared `VisitSummary`, ordered by scheduled_at (nulls last). Soft-deleted visits are excluded. */
export async function listVisits(db: Db, filter: ListVisitsFilter = {}): Promise<VisitSummary[]> {
  const counts = db
    .select({
      visitId: itemRecords.visitId,
      itemsTotal: sql<number>`count(*)::int`.as('items_total'),
      itemsGraded: sql<number>`count(${itemRecords.condition})::int`.as('items_graded'),
      defects: sql<number>`(count(*) filter (where ${itemRecords.condition} in ('F','P','U')))::int`.as('defects'),
    })
    .from(itemRecords)
    .leftJoin(roomInstances, eq(roomInstances.id, itemRecords.roomInstanceId))
    .where(
      and(
        isNull(itemRecords.deletedAt),
        or(isNull(itemRecords.roomInstanceId), and(eq(roomInstances.present, true), isNull(roomInstances.deletedAt))),
      ),
    )
    .groupBy(itemRecords.visitId)
    .as('counts');

  const londonDate = sql`(${visits.scheduledAt} at time zone 'Europe/London')::date`;
  const where: (SQL | undefined)[] = [isNull(visits.deletedAt)];
  if (filter.officerId) where.push(eq(visits.officerId, filter.officerId));
  if (filter.status) where.push(eq(visits.status, filter.status));
  if (filter.propertyId) where.push(eq(visits.propertyId, filter.propertyId));
  if (filter.from) where.push(sql`${londonDate} >= ${filter.from}::date`);
  if (filter.to) where.push(sql`${londonDate} <= ${filter.to}::date`);

  const rows = await db
    .select({
      id: visits.id, schemeCode: visits.schemeCode, visitType: visits.visitType, status: visits.status,
      scheduledAt: visits.scheduledAt, reportNumber: visits.reportNumber, officerId: visits.officerId, updatedAt: visits.updatedAt,
      addressLine1: properties.addressLine1, addressLine2: properties.addressLine2, postcode: properties.postcode,
      officerName: users.name,
      itemsTotal: sql<number>`coalesce(${counts.itemsTotal}, 0)`.mapWith(Number),
      itemsGraded: sql<number>`coalesce(${counts.itemsGraded}, 0)`.mapWith(Number),
      defects: sql<number>`coalesce(${counts.defects}, 0)`.mapWith(Number),
    })
    .from(visits)
    .innerJoin(properties, eq(properties.id, visits.propertyId))
    .innerJoin(users, eq(users.id, visits.officerId))
    .leftJoin(counts, eq(counts.visitId, visits.id))
    .where(and(...where))
    .orderBy(sql`${visits.scheduledAt} asc nulls last`, desc(visits.updatedAt))
    .limit(filter.limit ?? 500);

  return rows.map(({ addressLine1, addressLine2, ...r }) => ({
    ...r,
    scheduledAt: r.scheduledAt ? r.scheduledAt.toISOString() : null,
    updatedAt: r.updatedAt.toISOString(),
    address: formatAddress(addressLine1, addressLine2),
  }));
}

/** "Flat 3, 22 Surbiton Hill Rd" — line1 then line2, comma-separated. */
export const formatAddress = (line1: string, line2: string | null) => (line2 ? `${line1}, ${line2}` : line1);

