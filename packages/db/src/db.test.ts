import { eq, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VisitBundle, VisitSummary, buildFormDefinition, type CreateVisitRequest } from '@soc/shared';
import { createTestDb, type Db, type TestDbHandle } from './client.js';
import { isImmutableError, isUniqueViolation } from './errors.js';
import { claimNextJob, completeJob, enqueueJob, failJob } from './queries/jobs.js';
import { allocateReportNumber } from './queries/reports.js';
import { createSigningLink, findSigningLinkByTokenHash, listDisputes, listSigningLinks, signingLinkStatus } from './queries/signing.js';
import { createVisitFromForm, ensureRoomItems, getPublishedFormVersion, listVisits, loadVisitBundle } from './queries/visits.js';
import { DEFAULT_ROOM_PLANS } from './room-plans.js';
import * as s from './schema.js';
import { SEED_USERS, seed, seedPhrases } from './seed.js';

const def = buildFormDefinition();
const THREE_BED = DEFAULT_ROOM_PLANS['3-bed house'];
const itemsFor = (codes: string[]) => def.rooms.filter((r) => codes.includes(r.code)).reduce((n, r) => n + r.items.length, 0);

let h: TestDbHandle;
let db: Db;
let officerId: string;
let propertyId: string;

async function newVisit(rooms = THREE_BED, overrides: Partial<CreateVisitRequest> = {}) {
  const form = (await getPublishedFormVersion(db))!;
  const req: CreateVisitRequest = {
    id: uuidv7(), propertyId, schemeCode: 'PLS', visitType: 'check_in', presentRoomCodes: rooms,
    scheduledAt: '2026-11-16T09:30:00.000Z', ...overrides,
  };
  await db.transaction((tx) => createVisitFromForm(tx, req, officerId, form));
  return req.id;
}

/** Expect `fn` to be rejected by an immutability trigger. */
async function expectImmutable(fn: () => Promise<unknown>) {
  const err = await fn().then(() => null, (e: unknown) => e);
  expect(err, 'expected the write to be rejected').toBeTruthy();
  expect(isImmutableError(err), String(err)).toBe(true);
}

async function issue(visitId: string, number: string) {
  return db.transaction(async (tx) => {
    const reportId = uuidv7();
    await tx.insert(s.reports).values({ id: reportId, visitId, reportNumber: number, snapshot: { ok: true }, issuedBy: officerId });
    await tx.update(s.signatures).set({ reportId, updatedAt: new Date() }).where(eq(s.signatures.visitId, visitId));
    await tx.update(s.visits).set({ status: 'issued', reportNumber: number, updatedAt: new Date() }).where(eq(s.visits.id, visitId));
    return reportId;
  });
}

const count = async (t: PgTable) => (await db.select({ n: sql<number>`count(*)::int` }).from(t))[0]!.n;

beforeAll(async () => {
  h = await createTestDb({ seed: true });
  db = h.db;
  const [u] = await db.select().from(s.users).where(eq(s.users.email, 'p.dekaate@kingston.test'));
  officerId = u!.id;
  const [p] = await db.select().from(s.properties).where(eq(s.properties.addressLine1, '14 Acre Road'));
  propertyId = p!.id;
});
afterAll(async () => h?.close());

describe('migrations + seed', () => {
  it('applies cleanly with pg_trgm, triggers and deferrable photo FKs', async () => {
    const ext = await h.client.query(`select extname from pg_extension where extname = 'pg_trgm'`);
    expect(ext.rows).toHaveLength(1);
    const trg = await h.client.query<{ n: number }>(`select count(*)::int as n from pg_trigger where tgname like '%_immutable'`);
    expect(trg.rows[0]!.n).toBe(10);
    const fk = await h.client.query<{ condeferrable: boolean }>(
      `select condeferrable from pg_constraint where conname in ('room_instances_wide_photo_id_photos_id_fk','meter_readings_photo_id_photos_id_fk')`);
    expect(fk.rows.map((r) => r.condeferrable)).toEqual([true, true]);
  });

  it('seeds reference data idempotently', async () => {
    expect(await count(s.schemes)).toBe(4);
    expect(await count(s.users)).toBe(SEED_USERS.length);
    expect(await count(s.descriptionPhrases)).toBe(seedPhrases().length);
    expect(await count(s.visits)).toBe(3);
    await seed(db, { quiet: true });
    expect(await count(s.users)).toBe(SEED_USERS.length);
    expect(await count(s.visits)).toBe(3);
    expect(await count(s.descriptionPhrases)).toBe(seedPhrases().length);
    const form = await getPublishedFormVersion(db);
    expect(form?.version).toBe(1);
    expect((form?.definition as { rooms: unknown[] }).rooms).toHaveLength(15);
    const [admin] = await db.select().from(s.users).where(eq(s.users.role, 'admin'));
    expect(admin?.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('allows only one published form version', async () => {
    const err = await db.insert(s.formVersions)
      .values({ id: uuidv7(), version: 2, status: 'published', definition: def }).then(() => null, (e: unknown) => e);
    expect(err).toBeTruthy();
  });

  it('finds properties by trigram address search', async () => {
    const rows = await db.select().from(s.properties).where(sql`${s.properties.addressLine1} % 'Acre Rd'`);
    expect(rows.map((r) => r.addressLine1)).toContain('14 Acre Road');
  });
});

describe('createVisitFromForm', () => {
  it('creates one room per template room and items only for present rooms', async () => {
    const id = await newVisit();
    const rooms = await db.select().from(s.roomInstances).where(eq(s.roomInstances.visitId, id));
    expect(rooms).toHaveLength(15);
    expect(rooms.filter((r) => r.present).map((r) => r.roomCode).sort()).toEqual([...THREE_BED].sort());
    const items = await db.select().from(s.itemRecords).where(eq(s.itemRecords.visitId, id));
    expect(items).toHaveLength(itemsFor(THREE_BED));
    for (const room of rooms) {
      const tpl = def.rooms.find((r) => r.code === room.roomCode)!;
      const mine = items.filter((i) => i.roomInstanceId === room.id).sort((a, b) => a.sortOrder - b.sortOrder);
      expect(mine.map((i) => i.itemCode)).toEqual(room.present ? tpl.items.map((i) => i.code) : []);
    }
    expect(items.every((i) => i.condition === null)).toBe(true);
    const general = await db.select().from(s.visitGeneral).where(eq(s.visitGeneral.visitId, id));
    expect(Object.fromEntries(general.map((g) => [g.fieldCode, g.value])))
      .toMatchObject({ WINDOWS: 'UPVC Double Glazed', HEATING: 'Central Heating', KEYS_HELD: '' });
    expect(await db.select().from(s.appliances).where(eq(s.appliances.visitId, id))).toHaveLength(3);
    expect(await db.select().from(s.meterReadings).where(eq(s.meterReadings.visitId, id))).toHaveLength(4);
  });

  it('with every room present creates all 264 template items', async () => {
    const id = await newVisit(def.rooms.map((r) => r.code));
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(s.itemRecords).where(eq(s.itemRecords.visitId, id));
    expect(row!.n).toBe(264);
  });

  it('rejects unknown room codes', async () => {
    await expect(newVisit(['NOPE'])).rejects.toThrow(/unknown room code/);
  });

  it('ensureRoomItems fills a room marked present later, idempotently', async () => {
    const id = await newVisit();
    const [utility] = await db.select().from(s.roomInstances)
      .where(sql`${s.roomInstances.visitId} = ${id} and ${s.roomInstances.roomCode} = 'UTILITY'`);
    expect(await ensureRoomItems(db, utility!.id)).toBe(23);
    expect(await ensureRoomItems(db, utility!.id)).toBe(0);
  });
});

describe('loadVisitBundle / listVisits', () => {
  it('returns a VisitBundle that parses and hides soft-deleted rows', async () => {
    const id = await newVisit();
    const [first] = await db.select().from(s.itemRecords).where(eq(s.itemRecords.visitId, id)).limit(1);
    await db.update(s.itemRecords).set({ deletedAt: new Date(), condition: 'F' }).where(eq(s.itemRecords.id, first!.id));
    const bundle = await loadVisitBundle(db, id);
    expect(bundle).not.toBeNull();
    expect(() => VisitBundle.parse(bundle)).not.toThrow();
    expect(bundle!.rooms).toHaveLength(15);
    expect(bundle!.items).toHaveLength(itemsFor(THREE_BED) - 1);
    expect(bundle!.items.find((i) => i.id === first!.id)).toBeUndefined();
    expect(bundle!.landlord?.name).toBe('Pemberton Lettings');
    expect(bundle!.tenancy).toBeNull();
    expect(bundle!.visit.scheduledAt).toBe('2026-11-16T09:30:00.000Z');
    expect(await loadVisitBundle(db, uuidv7())).toBeNull();
  });

  it('lists visit summaries with item counts', async () => {
    const id = await newVisit(THREE_BED, { scheduledAt: '2030-01-02T10:00:00.000Z' });
    const items = await db.select().from(s.itemRecords).where(eq(s.itemRecords.visitId, id)).limit(3);
    await db.update(s.itemRecords).set({ condition: 'G' }).where(eq(s.itemRecords.id, items[0]!.id));
    await db.update(s.itemRecords).set({ condition: 'P' }).where(eq(s.itemRecords.id, items[1]!.id));
    const list = await listVisits(db, { from: '2030-01-02', to: '2030-01-02' });
    expect(list).toHaveLength(1);
    const v = VisitSummary.parse(list[0]);
    expect(v).toMatchObject({ id, address: '14 Acre Road', postcode: 'KT2 6EU', officerName: 'P. Dekaate', itemsGraded: 2, defects: 1 });
    expect(v.itemsTotal).toBe(itemsFor(THREE_BED));
    const mine = await listVisits(db, { officerId, status: 'scheduled' });
    expect(mine.length).toBeGreaterThanOrEqual(3);
    for (const row of mine) VisitSummary.parse(row);
  });
});

describe('immutability triggers', () => {
  it('blocks writes to an issued visit and its children; notes stay append-only', async () => {
    const id = await newVisit();
    await issue(id, 'SOC-2026-9001');
    const [item] = await db.select().from(s.itemRecords).where(eq(s.itemRecords.visitId, id)).limit(1);
    await expectImmutable(() => db.update(s.itemRecords).set({ condition: 'P' }).where(eq(s.itemRecords.id, item!.id)));
    await expectImmutable(() => db.delete(s.itemRecords).where(eq(s.itemRecords.id, item!.id)));
    await expectImmutable(() => db.update(s.visits).set({ status: 'completed' }).where(eq(s.visits.id, id)));
    await expectImmutable(() => db.delete(s.visits).where(eq(s.visits.id, id)));
    await expectImmutable(() => db.insert(s.itemRecords).values({
      id: uuidv7(), visitId: id, roomInstanceId: null, itemCode: null, label: 'Extra', sortOrder: 1,
    }));
    await expectImmutable(() => db.update(s.visitGeneral).set({ value: 'x' }).where(eq(s.visitGeneral.visitId, id)));
    // post-issue note: INSERT allowed, UPDATE/DELETE rejected
    const noteId = uuidv7();
    await db.insert(s.additionalNotes).values({ id: noteId, visitId: id, noteDate: '2026-11-20', note: 'Agreed', addedBy: 'J. Patel', signed: 'JP/LL' });
    await expectImmutable(() => db.update(s.additionalNotes).set({ note: 'changed' }).where(eq(s.additionalNotes.id, noteId)));
    await expectImmutable(() => db.delete(s.additionalNotes).where(eq(s.additionalNotes.id, noteId)));
  });

  it('reports: no delete, pdf fields fill once', async () => {
    const id = await newVisit();
    const reportId = await issue(id, 'SOC-2026-9002');
    const byId = eq(s.reports.id, reportId);
    await expectImmutable(() => db.delete(s.reports).where(byId));
    await expectImmutable(() => db.update(s.reports).set({ snapshot: { tampered: true } }).where(byId));
    await expectImmutable(() => db.update(s.reports).set({ reportNumber: 'SOC-2026-9999' }).where(byId));
    await db.update(s.reports).set({ pdfStorageKey: 'reports/x.pdf', sha256: 'a'.repeat(64), pdfReady: true }).where(byId);
    await expectImmutable(() => db.update(s.reports).set({ sha256: 'b'.repeat(64) }).where(byId));
    await expectImmutable(() => db.update(s.reports).set({ pdfReady: false }).where(byId));
    const bundle = await loadVisitBundle(db, id);
    expect(bundle!.report).toMatchObject({ reportNumber: 'SOC-2026-9002', pdfReady: true });
    expect(bundle!.visit.status).toBe('issued');
  });

  it('signatures: device-writable before issue, link-only inserts after, bundle shape', async () => {
    const id = await newVisit();
    const sig = (over: Partial<typeof s.signatures.$inferInsert> = {}) => ({
      id: uuidv7(), visitId: id, role: 'landlord_agent' as const, name: 'L. Lord', method: 'on_device' as const,
      signedAt: new Date('2026-11-16T10:00:00Z'), contentSha256: 'd'.repeat(64), updatedBy: officerId, ...over,
    });
    const landlord = sig({ imageStorageKey: `signatures/${id}/ll.png` });
    await db.insert(s.signatures).values(landlord);
    // one on-device signature per role per visit; re-sign = UPDATE
    const dup = await db.insert(s.signatures).values(sig()).then(() => null, (e: unknown) => e);
    expect(isUniqueViolation(dup)).toBe(true);
    await db.update(s.signatures).set({ name: 'L. Lord (agent)' }).where(eq(s.signatures.id, landlord.id));
    const officerSig = sig({ role: 'officer', name: 'J. Patel' });
    await db.insert(s.signatures).values(officerSig);

    const reportId = await issue(id, 'SOC-2026-9003');
    const [linked] = await db.select().from(s.signatures).where(eq(s.signatures.id, landlord.id));
    expect(linked!.reportId).toBe(reportId);

    await expectImmutable(() => db.update(s.signatures).set({ name: 'x' }).where(eq(s.signatures.id, landlord.id)));
    await expectImmutable(() => db.delete(s.signatures).where(eq(s.signatures.id, officerSig.id)));
    await expectImmutable(() => db.insert(s.signatures).values(sig({ role: 'tenant_check_in' })));
    await db.insert(s.signatures).values(sig({ role: 'tenant_check_in', method: 'link', reportId }));

    const bundle = await loadVisitBundle(db, id);
    expect(bundle!.signatures).toHaveLength(3);
    const ll = bundle!.signatures.find((x) => x.id === landlord.id)!;
    expect(ll).toEqual({
      id: landlord.id, visitId: id, reportId, role: 'landlord_agent', name: 'L. Lord (agent)', method: 'on_device',
      signedAt: '2026-11-16T10:00:00.000Z', contentSha256: 'd'.repeat(64), reportSha256: null, hasImage: true,
      updatedAt: ll.updatedAt, updatedBy: officerId,
    });
    expect(bundle!.signatures.find((x) => x.id === officerSig.id)!.hasImage).toBe(false);
  });

  it('deferrable photo FK: a room may reference a photo inserted later in the same tx', async () => {
    const id = await newVisit();
    const [room] = await db.select().from(s.roomInstances).where(eq(s.roomInstances.visitId, id)).limit(1);
    const photoId = uuidv7();
    await db.transaction(async (tx) => {
      await tx.update(s.roomInstances).set({ widePhotoId: photoId }).where(eq(s.roomInstances.id, room!.id));
      await tx.insert(s.photos).values({
        id: photoId, visitId: id, roomInstanceId: room!.id, capturedAt: new Date(), stampText: 'stamp',
        sha256: 'c'.repeat(64), bytes: 1, width: 1, height: 1, storageKey: `photos/${id}/${photoId}.jpg`,
      });
    });
    const bundle = await loadVisitBundle(db, id);
    expect(bundle!.photos).toHaveLength(1);
    expect(bundle!.rooms.find((r) => r.id === room!.id)?.widePhotoId).toBe(photoId);
  });
});

describe('report numbers', () => {
  it('increment per year', async () => {
    expect(await allocateReportNumber(db, 2031)).toBe('SOC-2031-0001');
    expect(await allocateReportNumber(db, 2031)).toBe('SOC-2031-0002');
    expect(await allocateReportNumber(db, 2032)).toBe('SOC-2032-0001');
    expect(await db.transaction((tx) => allocateReportNumber(tx, 2031))).toBe('SOC-2031-0003');
  });
});

describe('jobs queue', () => {
  it('claims exclusively, completes, retries and fails', async () => {
    const a = await enqueueJob(db, 'render_pdf', { reportId: 'a' });
    const b = await enqueueJob(db, 'render_pdf', { reportId: 'b' });
    await enqueueJob(db, 'render_pdf', { reportId: 'later' }, { runAfter: new Date(Date.now() + 3_600_000) });
    const [c1, c2, c3] = await Promise.all([claimNextJob(db), claimNextJob(db), claimNextJob(db)]);
    expect(new Set([c1?.id, c2?.id])).toEqual(new Set([a.id, b.id]));
    expect(c3).toBeNull();
    expect(c1!.status).toBe('running');
    expect(c1!.attempts).toBe(1);
    await completeJob(db, c1!.id);
    expect(await failJob(db, c2!.id, new Error('boom'), { maxAttempts: 2, retryDelaySeconds: 0 })).toBe('queued');
    const again = await claimNextJob(db, { kinds: ['render_pdf'] });
    expect(again?.id).toBe(c2!.id);
    expect(again?.attempts).toBe(2);
    expect(await failJob(db, again!.id, 'boom again', { maxAttempts: 2 })).toBe('failed');
    expect(await claimNextJob(db)).toBeNull();
  });
});

describe('signing links + disputes', () => {
  it('constraints, unique token hash, status derivation, writes allowed after issue', async () => {
    const id = await newVisit();
    const reportId = await issue(id, 'SOC-2026-9004');
    const hash = (n: string) => `hash-${n}-${reportId}`;
    const base = { reportId, createdBy: officerId };

    const pending = await createSigningLink(db, { ...base, role: 'landlord_agent', tokenHash: hash('a'), recipientName: 'L. Lord', recipientEmail: 'l@example.com' });
    expect(pending.expiresAt.getTime() - Date.now()).toBeGreaterThan(13 * 86_400_000);
    expect(await findSigningLinkByTokenHash(db, hash('a'))).toMatchObject({ id: pending.id });
    expect(await findSigningLinkByTokenHash(db, 'nope')).toBeNull();

    // unique token hash; officer role not allowed
    const dupErr = await createSigningLink(db, { ...base, role: 'tenant_check_in', tokenHash: hash('a') }).then(() => null, (e: unknown) => e);
    expect(isUniqueViolation(dupErr)).toBe(true);
    const roleErr = await createSigningLink(db, { ...base, role: 'officer' as never, tokenHash: hash('o') }).then(() => null, (e: unknown) => e);
    expect(roleErr).toBeTruthy();

    const expired = await createSigningLink(db, { ...base, role: 'tenant_check_in', tokenHash: hash('e'), expiresAt: new Date(Date.now() - 1000) });
    const revoked = await createSigningLink(db, { ...base, role: 'tenant_check_out', tokenHash: hash('r') });
    await db.update(s.signingLinks).set({ revokedAt: new Date() }).where(eq(s.signingLinks.id, revoked.id));

    // link signing after issue: INSERT signature (method 'link') + UPDATE the link
    const signed = await createSigningLink(db, { ...base, role: 'tenant_check_in', tokenHash: hash('s') });
    const sigId = uuidv7();
    await db.transaction(async (tx) => {
      await tx.insert(s.signatures).values({ id: sigId, visitId: id, reportId, role: 'tenant_check_in', name: 'T. Enant', method: 'link', reportSha256: 'e'.repeat(64) });
      await tx.update(s.signingLinks).set({ openedAt: new Date(), signedAt: new Date(), signatureId: sigId }).where(eq(s.signingLinks.id, signed.id));
    });

    // dispute on an item of the issued visit, then resolve it
    const [item] = await db.select().from(s.itemRecords).where(eq(s.itemRecords.visitId, id)).orderBy(s.itemRecords.sortOrder).limit(1);
    const disputeId = uuidv7();
    await db.insert(s.disputes).values({ id: disputeId, reportId, signingLinkId: pending.id, itemRecordId: item!.id, comment: 'Gate was already broken' });
    await db.update(s.disputes).set({ resolvedAt: new Date(), resolvedBy: officerId }).where(eq(s.disputes.id, disputeId));
    const badItem = await db.insert(s.disputes).values({ id: uuidv7(), reportId, signingLinkId: pending.id, itemRecordId: uuidv7(), comment: 'x' }).then(() => null, (e: unknown) => e);
    expect(badItem).toBeTruthy();

    const links = await listSigningLinks(db, reportId);
    expect(Object.fromEntries(links.map((l) => [l.id, l.status]))).toEqual({
      [pending.id]: 'pending', [expired.id]: 'expired', [revoked.id]: 'revoked', [signed.id]: 'signed',
    });
    expect(links.find((l) => l.id === pending.id)!.disputes).toBe(1);
    expect(links.find((l) => l.id === signed.id)!.openedAt).not.toBeNull();
    expect(signingLinkStatus({ ...pending, signedAt: null, revokedAt: null }, new Date(pending.expiresAt.getTime() + 1))).toBe('expired');

    const ds = await listDisputes(db, reportId);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ id: disputeId, signingLinkId: pending.id, itemRecordId: item!.id, room: 'FRONT GARDEN', item: item!.label, comment: 'Gate was already broken' });
    expect(ds[0]!.resolvedAt).not.toBeNull();

    const bundle = await loadVisitBundle(db, id);
    expect(bundle!.signatures.map((x) => x.method)).toEqual(['link']);
  });
});
