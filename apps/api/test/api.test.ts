import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEV_PASSWORD_DEFAULT, SEED_OFFICER_EMAIL, auditEvents, itemRecords, visits } from '@soc/db';
import { processNextJob } from '../src/pdf/worker.js';
import {
  createVisit, fakeJpeg, login, mutation, photoRow, push, setup, tick, uploadPhoto, userId,
} from './helpers.js';
import type { TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await setup();
});
afterAll(async () => {
  await t?.close();
});

describe('health', () => {
  it('reports db status', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, db: true });
  });
});

describe('auth', () => {
  it('rejects a wrong password with the standard error shape', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: SEED_OFFICER_EMAIL, password: 'nope' } });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'INVALID_CREDENTIALS' } });
  });

  it('logs in with an HttpOnly SameSite=Lax cookie, then me, then logout', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: SEED_OFFICER_EMAIL.toUpperCase(), password: DEV_PASSWORD_DEFAULT } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ email: SEED_OFFICER_EMAIL, role: 'officer' });
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    const c = res.cookies.find((x) => x.name === 'soc_session')!;
    const cookie = `soc_session=${c.value}`;

    const me = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.name).toBe('P. Dekaate');

    const out = await t.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect(out.statusCode).toBe(204);
    const after = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });

  it('rejects a tampered cookie', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: 'soc_session=abc.def' } });
    expect(res.statusCode).toBe(401);
  });

  it('guards roles: admin-only users list, officers only see their own visits', async () => {
    const officer = await login(t, 'officer');
    const admin = await login(t, 'admin');
    const other = await login(t, 'officer2');
    const manager = await login(t, 'manager');
    expect((await t.app.inject({ method: 'GET', url: '/api/users', headers: { cookie: officer } })).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'GET', url: '/api/users', headers: { cookie: admin } })).statusCode).toBe(200);

    const bundle = await createVisit(t, officer);
    const url = `/api/visits/${bundle.visit.id}`;
    expect((await t.app.inject({ method: 'GET', url, headers: { cookie: officer } })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url, headers: { cookie: other } })).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'GET', url, headers: { cookie: manager } })).statusCode).toBe(200);

    const list = await t.app.inject({ method: 'GET', url: '/api/visits', headers: { cookie: other } });
    expect(list.json().visits.every((v: { officerId: string }) => v.officerId !== bundle.visit.officerId)).toBe(true);
    const r = await push(t, other, [mutation('visit', bundle.visit.id, { status: 'in_progress' })]);
    expect(r.results[0]!.status).toBe('rejected');
  });

  it('dev users + dev login are available outside production', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/auth/dev-users' });
    expect(res.statusCode).toBe(200);
    const users = res.json().users as { id: string; role: string }[];
    expect(users.length).toBeGreaterThanOrEqual(4);
    const login = await t.app.inject({ method: 'POST', url: '/api/auth/dev-login', payload: { userId: users[0]!.id } });
    expect(login.statusCode).toBe(200);
    expect(login.cookies.some((c) => c.name === 'soc_session')).toBe(true);
  });
});

describe('dev login in production', () => {
  it('is not registered', async () => {
    const prod = await setup({ nodeEnv: 'production' });
    try {
      expect((await prod.app.inject({ method: 'GET', url: '/api/auth/dev-users' })).statusCode).toBe(404);
      const res = await prod.app.inject({ method: 'POST', url: '/api/auth/dev-login', payload: { userId: uuidv7() } });
      expect(res.statusCode).toBe(404);
    } finally {
      await prod.close();
    }
  });
});

describe('visits', () => {
  it('creates a visit with rooms and items pre-created from the form', async () => {
    const cookie = await login(t, 'officer');
    const b = await createVisit(t, cookie, ['FRONT_DOOR', 'KITCHEN']);
    expect(b.rooms).toHaveLength(15);
    expect(b.rooms.filter((r) => r.present).map((r) => r.roomCode)).toEqual(['FRONT_DOOR', 'KITCHEN']);
    expect(b.items).toHaveLength(10 + 32);
    expect(b.general.find((g) => g.fieldCode === 'WINDOWS')?.value).toBe('UPVC Double Glazed');
    expect(b.appliances).toHaveLength(3);
    expect(b.meters).toHaveLength(4);
    expect(b.visit.officerId).toBe(await userId(t, 'officer'));

    const bad = await t.app.inject({ method: 'POST', url: '/api/visits', headers: { cookie }, payload: { id: 'x' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('renders a draft preview with a CSP header', async () => {
    const cookie = await login(t, 'officer');
    const b = await createVisit(t, cookie);
    const res = await t.app.inject({ method: 'GET', url: `/api/visits/${b.visit.id}/preview`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.body).toContain('DRAFT — not issued');
    expect(res.body).toContain('FRONT DOOR');
  });
});

describe('sync push', () => {
  it('is idempotent per mutationId', async () => {
    const cookie = await login(t, 'officer');
    const b = await createVisit(t, cookie);
    const item = b.items[0]!;
    const m = mutation('item_record', item.id, { visitId: b.visit.id, condition: 'G' });
    const first = await push(t, cookie, [m]);
    expect(first.results[0]).toEqual({ mutationId: m.mutationId, status: 'applied' });
    const again = await push(t, cookie, [m]);
    expect(again.results[0]!.status).toBe('duplicate');
    const events = await t.handle.db.select().from(auditEvents).where(eq(auditEvents.entityId, item.id));
    expect(events).toHaveLength(1);
  });

  it('applies last-write-wins per field', async () => {
    const cookie = await login(t, 'officer');
    const b = await createVisit(t, cookie);
    const item = b.items[1]!;
    const t1 = tick();
    const t2 = tick();
    const t3 = tick();
    // Device B edits the comment later (t3); device A edits condition (t2) and comment (t1, older).
    await push(t, cookie, [mutation('item_record', item.id, { visitId: b.visit.id, comment: 'from B' }, t3)], 'device-b');
    const a = await push(t, cookie, [mutation('item_record', item.id, { visitId: b.visit.id, condition: 'F', comment: 'from A (older)' }, t2)], 'device-a');
    expect(a.results[0]!.status).toBe('applied');
    // Older write to the same field loses; a different field from the other device wins.
    const older = await push(t, cookie, [mutation('item_record', item.id, { visitId: b.visit.id, condition: 'P' }, t1)], 'device-a');
    expect(older.results[0]!.status).toBe('applied');
    const [row] = await t.handle.db.select().from(itemRecords).where(eq(itemRecords.id, item.id));
    expect(row!.comment).toBe('from B');
    expect(row!.condition).toBe('F');
  });

  it('validates merged rows with the shared schema and rejects unknown/server fields', async () => {
    const cookie = await login(t, 'officer');
    const b = await createVisit(t, cookie);
    const item = b.items[0]!;
    const r = await push(t, cookie, [
      mutation('item_record', item.id, { visitId: b.visit.id, condition: 'X' }),
      mutation('item_record', item.id, { visitId: b.visit.id, bogus: 1 }),
      mutation('visit', b.visit.id, { status: 'issued' }),
      mutation('visit', b.visit.id, { reportNumber: 'SOC-2026-9999' }),
    ]);
    expect(r.results.map((x) => x.status)).toEqual(['rejected', 'rejected', 'rejected', 'rejected']);
  });

  it('creates template items when a room becomes present, and resolves out-of-order references', async () => {
    const cookie = await login(t, 'officer');
    const b = await createVisit(t, cookie);
    const kitchen = b.rooms.find((r) => r.roomCode === 'KITCHEN')!;
    const { sha256 } = fakeJpeg();
    const photoId = uuidv7();
    // Room references a photo pushed later in the same batch.
    const r = await push(t, cookie, [
      mutation('room_instance', kitchen.id, { visitId: b.visit.id, present: true, widePhotoId: photoId }),
      mutation('photo', photoId, photoRow(b.visit.id, sha256, { roomInstanceId: kitchen.id })),
    ]);
    expect(r.results.map((x) => x.status)).toEqual(['applied', 'applied']);
    const items = await t.handle.db.select().from(itemRecords).where(eq(itemRecords.roomInstanceId, kitchen.id));
    expect(items).toHaveLength(32);
  });

  it('creates new rows (miscellaneous item, note) from the device', async () => {
    const cookie = await login(t, 'officer');
    const b = await createVisit(t, cookie);
    const r = await push(t, cookie, [
      mutation('item_record', uuidv7(), {
        visitId: b.visit.id, roomInstanceId: null, itemCode: null, label: 'GARDEN TABLE', sortOrder: 10, qty: 1,
        description: 'Teak', condition: 'G', naReason: null, comment: null, dilapidation: null,
      }),
      mutation('additional_note', uuidv7(), { visitId: b.visit.id, noteDate: '2026-11-15', note: 'Loft not accessed.', addedBy: 'P. Dekaate', signed: null }),
    ]);
    expect(r.results.map((x) => x.status)).toEqual(['applied', 'applied']);
  });
});

describe('photos', () => {
  it('rejects an upload whose SHA-256 does not match, accepts the right one, and streams it', async () => {
    const cookie = await login(t, 'officer');
    const b = await createVisit(t, cookie);
    const { bytes, sha256 } = fakeJpeg();
    const id = uuidv7();
    await push(t, cookie, [mutation('photo', id, photoRow(b.visit.id, sha256))]);

    const other = fakeJpeg();
    const wrongHeader = await uploadPhoto(t, cookie, id, bytes, other.sha256);
    expect(wrongHeader.statusCode).toBe(422);
    expect(wrongHeader.json().error.code).toBe('SHA256_MISMATCH');
    const wrongBody = await uploadPhoto(t, cookie, id, other.bytes, other.sha256);
    expect(wrongBody.statusCode).toBe(422);

    const ok = await uploadPhoto(t, cookie, id, bytes, sha256);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().photo.uploaded).toBe(true);
    const get = await t.app.inject({ method: 'GET', url: `/api/photos/${id}/file`, headers: { cookie } });
    expect(get.statusCode).toBe(200);
    expect(get.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.compare(get.rawPayload, bytes)).toBe(0);

    const stranger = await login(t, 'officer2');
    expect((await t.app.inject({ method: 'GET', url: `/api/photos/${id}/file`, headers: { cookie: stranger } })).statusCode).toBe(403);
  });
});

describe('issue', () => {
  it('is blocked until the visit is complete, then issues, renders the PDF and becomes immutable', async () => {
    const cookie = await login(t, 'officer');
    const b = await createVisit(t, cookie, ['FRONT_DOOR']);
    const vid = b.visit.id;

    const blocked = await t.app.inject({ method: 'POST', url: `/api/visits/${vid}/issue`, headers: { cookie } });
    expect(blocked.statusCode).toBe(409);
    const body = blocked.json();
    expect(body.error.code).toBe('ISSUE_BLOCKED');
    const codes = new Set(body.blockers.map((x: { code: string }) => x.code));
    expect(codes).toEqual(new Set(['GENERAL_MISSING', 'ROOM_NO_WIDE_PHOTO', 'ITEM_UNGRADED']));

    // Complete the visit: general fields, a wide photo for the room, every item graded (one defect with comment + photo).
    const room = b.rooms.find((r) => r.present)!;
    const items = b.items.filter((i) => i.roomInstanceId === room.id);
    const wide = fakeJpeg();
    const defect = fakeJpeg();
    const wideId = uuidv7();
    const defectId = uuidv7();
    const g = (code: string) => b.general.find((x) => x.fieldCode === code)!;
    const res = await push(t, cookie, [
      mutation('visit_general', g('DESCRIPTION_OF_PROPERTY').id, { visitId: vid, value: '3-bed house' }),
      mutation('visit_general', g('GENERAL_CONDITION').id, { visitId: vid, value: 'Good' }),
      mutation('photo', wideId, photoRow(vid, wide.sha256, { roomInstanceId: room.id })),
      mutation('photo', defectId, photoRow(vid, defect.sha256, { roomInstanceId: room.id, itemRecordId: items[0]!.id })),
      mutation('room_instance', room.id, { visitId: vid, widePhotoId: wideId }),
      mutation('item_record', items[0]!.id, { visitId: vid, condition: 'F', comment: 'Scuffed' }),
      ...items.slice(1).map((i) => mutation('item_record', i.id, { visitId: vid, condition: 'G' })),
    ]);
    expect(res.results.every((x) => x.status === 'applied')).toBe(true);

    // Photos not uploaded yet → server-side blocker.
    const pending = await t.app.inject({ method: 'GET', url: `/api/visits/${vid}/blockers`, headers: { cookie } });
    expect(pending.json().blockers.map((x: { code: string }) => x.code)).toEqual(['PHOTO_NOT_UPLOADED', 'PHOTO_NOT_UPLOADED']);
    expect((await uploadPhoto(t, cookie, wideId, wide.bytes, wide.sha256)).statusCode).toBe(200);
    expect((await uploadPhoto(t, cookie, defectId, defect.bytes, defect.sha256)).statusCode).toBe(200);
    const clear = await t.app.inject({ method: 'GET', url: `/api/visits/${vid}/blockers`, headers: { cookie } });
    expect(clear.json().blockers).toEqual([]);

    const issued = await t.app.inject({ method: 'POST', url: `/api/visits/${vid}/issue`, headers: { cookie } });
    expect(issued.statusCode).toBe(201);
    const report = issued.json().report;
    expect(report.reportNumber).toMatch(/^SOC-\d{4}-\d{4}$/);
    expect(report.pdfReady).toBe(false);

    const bundle = (await t.app.inject({ method: 'GET', url: `/api/visits/${vid}`, headers: { cookie } })).json();
    expect(bundle.visit.status).toBe('issued');
    expect(bundle.photos.map((p: { ref: string }) => p.ref)).toEqual(['P-1', 'P-2']);

    // PDF not rendered yet → 202; run the worker once → ready, hashed, emailed.
    expect((await t.app.inject({ method: 'GET', url: `/api/reports/${report.id}/pdf`, headers: { cookie } })).statusCode).toBe(202);
    expect(await processNextJob(t.app.ctx)).toBe(true);
    expect(t.pdf.rendered.at(-1)).toContain(report.reportNumber);
    expect(t.pdf.rendered.at(-1)).toContain('data:image/jpeg;base64,');
    expect(t.pdf.rendered.at(-1)).not.toContain('DRAFT — not issued');
    const pdf = await t.app.inject({ method: 'GET', url: `/api/reports/${report.id}/pdf`, headers: { cookie } });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const meta = (await t.app.inject({ method: 'GET', url: `/api/reports/${report.id}`, headers: { cookie } })).json();
    expect(meta.report.pdfReady).toBe(true);
    expect(meta.report.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(t.mail.sent.at(-1)?.subject).toContain(report.reportNumber);

    // Immutable: pushes rejected, second issue 409; post-issue note + signature allowed.
    const late = await push(t, cookie, [mutation('item_record', items[1]!.id, { visitId: vid, comment: 'late edit' })]);
    expect(late.results[0]!.status).toBe('rejected');
    expect(late.results[0]!.error).toMatch(/VISIT_ISSUED/);
    expect((await t.app.inject({ method: 'POST', url: `/api/visits/${vid}/issue`, headers: { cookie } })).statusCode).toBe(409);
    const note = await t.app.inject({
      method: 'POST', url: `/api/reports/${report.id}/notes`, headers: { cookie },
      payload: { noteDate: '2026-11-16', note: 'Keys returned', addedBy: 'P. Dekaate', signed: 'AP/PD' },
    });
    expect(note.statusCode).toBe(201);
    const sig = await t.app.inject({
      method: 'POST', url: `/api/reports/${report.id}/signatures`, headers: { cookie },
      payload: { role: 'officer', name: 'P. Dekaate', method: 'officer_only' },
    });
    expect(sig.statusCode).toBe(201);
    expect(sig.json().signature.reportSha256).toBe(meta.report.sha256);
    const dup = await t.app.inject({
      method: 'POST', url: `/api/reports/${report.id}/signatures`, headers: { cookie },
      payload: { role: 'officer', name: 'P. Dekaate', method: 'officer_only' },
    });
    expect(dup.statusCode).toBe(409);

    const [v] = await t.handle.db.select().from(visits).where(eq(visits.id, vid));
    expect(v!.reportNumber).toBe(report.reportNumber);
  });
});

describe('reference, properties, users', () => {
  it('serves reference data and property search', async () => {
    const cookie = await login(t, 'officer');
    const ref = (await t.app.inject({ method: 'GET', url: '/api/reference', headers: { cookie } })).json();
    expect(ref.formVersion.definition.rooms).toHaveLength(15);
    expect(ref.schemes).toHaveLength(4);
    expect(ref.phrases.length).toBeGreaterThan(10);
    const search = (await t.app.inject({ method: 'GET', url: '/api/properties?q=kt2 6eu', headers: { cookie } })).json();
    expect(search.properties[0].addressLine1).toBe('14 Acre Road');
    expect(search.properties[0].landlord.company).toBe('Pemberton Lettings Ltd');
  });

  it('creates a property with a landlord, and an admin creates a user', async () => {
    const cookie = await login(t, 'officer');
    const res = await t.app.inject({
      method: 'POST', url: '/api/properties', headers: { cookie },
      payload: {
        id: uuidv7(), uprn: null, addressLine1: '1 Test Street', addressLine2: null, town: 'Kingston upon Thames', postcode: 'KT1 1AA',
        propertyType: '1-bed flat', bedrooms: 1, landlordId: null,
        landlord: { id: uuidv7(), name: 'T. Landlord', company: null, email: 't@example.org', phone: null },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().property.landlord.name).toBe('T. Landlord');

    const admin = await login(t, 'admin');
    const u = await t.app.inject({
      method: 'POST', url: '/api/users', headers: { cookie: admin },
      payload: { email: 'new.officer@kingston.test', name: 'New Officer', role: 'officer', password: 'a-long-password-123' },
    });
    expect(u.statusCode).toBe(201);
    const login2 = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'new.officer@kingston.test', password: 'a-long-password-123' } });
    expect(login2.statusCode).toBe(200);
  });
});
