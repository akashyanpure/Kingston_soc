import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEV_PASSWORD_DEFAULT, sessions, users } from '@soc/db';
import type { ManagerOverview } from '@soc/shared';
import { processNextJob } from '../src/pdf/worker.js';
import { anyPropertyId, completeVisit, createVisit, fakeJpeg, login, mutation, push, setup, sign, userId } from './helpers.js';
import type { TestApp } from './helpers.js';

let t: TestApp;
let officer: string;
let manager: string;
let admin: string;
beforeAll(async () => {
  t = await setup();
  [officer, manager, admin] = await Promise.all([login(t, 'officer'), login(t, 'manager'), login(t, 'admin')]);
});
afterAll(async () => {
  await t?.close();
});

const get = (url: string, cookie: string) => t.app.inject({ method: 'GET', url, headers: { cookie } });
const send = (method: 'POST' | 'PATCH' | 'DELETE', url: string, cookie: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { cookie }, ...(payload !== undefined ? { payload: payload as object } : {}) });

describe('role guards', () => {
  const manageRoutes = ['/api/manage/overview', '/api/manage/reports'];
  const adminGets = ['/api/admin/phrases', '/api/admin/form', '/api/admin/system', '/api/admin/audit', '/api/users'];

  it('officers get 403 on /manage and /admin; managers get 403 on /admin; unauthenticated 401', async () => {
    for (const url of [...manageRoutes, ...adminGets]) {
      expect((await get(url, officer)).statusCode, url).toBe(403);
      expect((await t.app.inject({ method: 'GET', url })).statusCode, url).toBe(401);
    }
    for (const url of manageRoutes) {
      expect((await get(url, manager)).statusCode, url).toBe(200);
      expect((await get(url, admin)).statusCode, url).toBe(200);
    }
    for (const url of adminGets) {
      expect((await get(url, manager)).statusCode, url).toBe(403);
      expect((await get(url, admin)).statusCode, url).toBe(200);
    }
    const someId = uuidv7();
    const writes: [method: 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown][] = [
      ['POST', '/api/admin/phrases', { itemCode: 'WALLS', phrase: 'x' }],
      ['DELETE', `/api/admin/phrases/${someId}`],
      ['PATCH', '/api/admin/schemes/PLS', { name: 'Hacked Scheme' }],
      ['PATCH', `/api/users/${someId}`, { name: 'x' }],
      ['POST', `/api/users/${someId}/reset-password`, { password: 'a-long-password-123' }],
    ];
    for (const [m, url, body] of writes) {
      expect((await send(m, url, officer, body)).statusCode, `${m} ${url}`).toBe(403);
      expect((await send(m, url, manager, body)).statusCode, `${m} ${url}`).toBe(403);
    }
  });
});

describe('POST /visits officerId', () => {
  it('only managers/admins may schedule for another officer, and only for an active officer', async () => {
    const other = await userId(t, 'officer2');
    const base = { propertyId: await anyPropertyId(t), schemeCode: 'PLS', visitType: 'check_in', presentRoomCodes: ['FRONT_DOOR'] };
    const asOfficer = await send('POST', '/api/visits', officer, { ...base, id: uuidv7(), officerId: other });
    expect(asOfficer.statusCode).toBe(403);
    const own = await send('POST', '/api/visits', officer, { ...base, id: uuidv7(), officerId: await userId(t, 'officer') });
    expect(own.statusCode).toBe(201);
    const notOfficer = await send('POST', '/api/visits', manager, { ...base, id: uuidv7(), officerId: await userId(t, 'admin') });
    expect(notOfficer.statusCode).toBe(400);
    const scheduled = await send('POST', '/api/visits', manager, { ...base, id: uuidv7(), officerId: other, scheduledAt: new Date().toISOString() });
    expect(scheduled.statusCode).toBe(201);
    expect(scheduled.json().visit.officerId).toBe(other);
    // The other officer now sees it; the manager did not become its officer.
    const theirs = await get('/api/visits', await login(t, 'officer2'));
    expect(theirs.json().visits.some((v: { id: string }) => v.id === scheduled.json().visit.id)).toBe(true);
  });
});

describe('manager overview + archive', () => {
  it('counts scheduled/issued/U items/unsigned/median on a small fixture', async () => {
    const overview = async () => (await get('/api/manage/overview', manager)).json() as ManagerOverview;
    const before = await overview();
    expect(before.from <= before.to).toBe(true);
    expect(before.byOfficer.map((o) => o.name).sort()).toEqual(['P. Dekaate', 'S. Officer']);

    // Fixture: one visit completed in 40 minutes with a U item, signed by the officer only, issued.
    const b = await createVisit(t, officer, ['FRONT_DOOR']);
    const vid = b.visit.id;
    await completeVisit(t, officer, b, fakeJpeg, { sign: false });
    const item = b.items.find((i) => i.roomInstanceId !== null)!; // first item: has photo + comment from completeVisit
    const now = Date.now();
    await push(t, officer, [
      mutation('item_record', item.id, { visitId: vid, condition: 'U', comment: 'Exposed wiring' }),
      mutation('visit', vid, { status: 'in_progress', startedAt: new Date(now - 40 * 60_000).toISOString() }),
      mutation('visit', vid, { status: 'completed', completedAt: new Date(now).toISOString() }),
    ]);
    expect((await sign(t, officer, vid)).result.status).toBe('applied');
    const issued = await send('POST', `/api/visits/${vid}/issue`, officer);
    expect(issued.statusCode).toBe(201);
    const report = issued.json().report;

    // And a visit scheduled today for the second officer.
    const other = await userId(t, 'officer2');
    const sched = await send('POST', '/api/visits', manager, {
      id: uuidv7(), propertyId: await anyPropertyId(t), schemeCode: 'NP', visitType: 'check_out', presentRoomCodes: ['KITCHEN'],
      officerId: other, scheduledAt: new Date().toISOString(),
    });
    expect(sched.statusCode).toBe(201);

    const after = await overview();
    expect(after.kpis.issued - before.kpis.issued).toBe(1);
    expect(after.kpis.unsignedByLandlord - before.kpis.unsignedByLandlord).toBe(1);
    expect(after.kpis.unacceptableOpen - before.kpis.unacceptableOpen).toBe(1);
    expect(after.kpis.scheduled - before.kpis.scheduled).toBe(1);
    expect(after.kpis.medianMinutesPerSoc).toBe(40);
    const me = after.byOfficer.find((o) => o.name === 'P. Dekaate')!;
    const them = after.byOfficer.find((o) => o.officerId === other)!;
    expect(me.issued).toBe(1);
    expect(me.medianMinutes).toBe(40);
    expect(them.scheduled - before.byOfficer.find((o) => o.officerId === other)!.scheduled).toBe(1);
    expect(them.issued).toBe(0);
    expect(after.unacceptable[0]).toMatchObject({ visitId: vid, item: item.label, comment: 'Exposed wiring', officerName: 'P. Dekaate' });
    expect(after.unsigned.some((u) => u.reportId === report.id && u.reportNumber === report.reportNumber)).toBe(true);

    // Explicit empty range far in the past.
    const past = (await get('/api/manage/overview?from=2001-01-01&to=2001-01-07', manager)).json() as ManagerOverview;
    expect(past.kpis).toMatchObject({ scheduled: 0, inProgress: 0, completed: 0, issued: 0, unacceptableOpen: 0, unsignedByLandlord: 0, medianMinutesPerSoc: null });
    expect(past.byOfficer).toHaveLength(2);
    expect((await get('/api/manage/overview?from=2026-02-01&to=2026-01-01', manager)).statusCode).toBe(400);

    // Archive: by report number and by postcode (spacing/case-insensitive).
    const byNumber = (await get(`/api/manage/reports?q=${report.reportNumber}`, manager)).json().reports;
    expect(byNumber).toHaveLength(1);
    expect(byNumber[0]).toMatchObject({ reportId: report.id, visitId: vid, landlordSigned: false, pdfReady: false, schemeCode: 'PLS', officerName: 'P. Dekaate' });
    expect(byNumber[0].defects).toBe(1);
    const pc = b.property.postcode.replace(/\s+/g, '').toLowerCase();
    const byPostcode = (await get(`/api/manage/reports?q=${encodeURIComponent(pc)}`, manager)).json().reports;
    expect(byPostcode.map((r: { reportId: string }) => r.reportId)).toContain(report.id);
    expect((await get('/api/manage/reports?q=nothing-matches-this', manager)).json().reports).toEqual([]);
    expect((await get('/api/manage/reports?scheme=TF', manager)).json().reports).toEqual([]);

    // Landlord signs later by link → no longer in the unsigned list.
    await processNextJob(t.app.ctx);
    const link = await send('POST', `/api/reports/${report.id}/signatures`, manager, { role: 'landlord_agent', name: 'A. Pemberton', method: 'link' });
    expect(link.statusCode).toBe(201);
    const signed = await overview();
    expect(signed.kpis.unsignedByLandlord).toBe(after.kpis.unsignedByLandlord - 1);
    expect((await get(`/api/manage/reports?q=${report.reportNumber}`, admin)).json().reports[0]).toMatchObject({ landlordSigned: true, pdfReady: true });
  });
});

describe('admin: users', () => {
  it('updates users, prevents self-lockout, and deactivation ends sessions', async () => {
    const created = await send('POST', '/api/users', admin, { email: 'temp.officer@kingston.test', name: 'Temp Officer', role: 'officer', password: 'a-long-password-123' });
    expect(created.statusCode).toBe(201);
    const id = created.json().user.id as string;
    const renamed = await send('PATCH', `/api/users/${id}`, admin, { name: 'Temp Officer Renamed', role: 'manager' });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().user).toMatchObject({ name: 'Temp Officer Renamed', role: 'manager', active: true });
    expect((await send('PATCH', `/api/users/${id}`, admin, {})).statusCode).toBe(400);

    const adminId = await userId(t, 'admin');
    const selfDemote = await send('PATCH', `/api/users/${adminId}`, admin, { role: 'manager' });
    expect(selfDemote.statusCode).toBe(409);
    expect(selfDemote.json().error.code).toBe('SELF_LOCKOUT');
    expect((await send('PATCH', `/api/users/${adminId}`, admin, { active: false })).json().error.code).toBe('SELF_LOCKOUT');
    expect((await send('PATCH', `/api/users/${adminId}`, admin, { name: 'Admin Renamed' })).statusCode).toBe(200);

    // Deactivate: their session stops working and their sessions rows are gone.
    const theirCookie = (await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'temp.officer@kingston.test', password: 'a-long-password-123' } })).cookies.find((c) => c.name === 'soc_session')!;
    const cookie = `soc_session=${theirCookie.value}`;
    expect((await get('/api/auth/me', cookie)).statusCode).toBe(200);
    expect((await send('PATCH', `/api/users/${id}`, admin, { active: false })).json().user.active).toBe(false);
    expect((await get('/api/auth/me', cookie)).statusCode).toBe(401);
    expect(await t.handle.db.select().from(sessions).where(eq(sessions.userId, id))).toHaveLength(0);
    expect((await send('PATCH', `/api/users/${uuidv7()}`, admin, { name: 'x' })).statusCode).toBe(404);
  });

  it('a second admin can be demoted while one admin remains', async () => {
    const second = await send('POST', '/api/users', admin, { email: 'admin2@kingston.test', name: 'Admin Two', role: 'admin', password: 'a-long-password-123' });
    const id = second.json().user.id as string;
    expect((await send('PATCH', `/api/users/${id}`, admin, { role: 'officer' })).statusCode).toBe(200);
  });

  it('reset-password sets a new password and ends that user’s sessions', async () => {
    const officerId = await userId(t, 'officer2');
    const before = await login(t, 'officer2');
    expect((await get('/api/auth/me', before)).statusCode).toBe(200);
    const reset = await send('POST', `/api/users/${officerId}/reset-password`, admin, { password: 'brand-new-password-1' });
    expect(reset.statusCode).toBe(204);
    expect((await get('/api/auth/me', before)).statusCode).toBe(401);
    const email = (await t.handle.db.select({ email: users.email }).from(users).where(eq(users.id, officerId)))[0]!.email;
    const oldPw = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: DEV_PASSWORD_DEFAULT } });
    expect(oldPw.statusCode).toBe(401);
    const newPw = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'brand-new-password-1' } });
    expect(newPw.statusCode).toBe(200);
    expect((await send('POST', `/api/users/${officerId}/reset-password`, admin, { password: 'short' })).statusCode).toBe(400);
  });
});

describe('admin: library, schemes, form, system, audit', () => {
  it('creates, lists and deletes phrases; duplicates are 409; they show in /reference', async () => {
    const created = await send('POST', '/api/admin/phrases', admin, { itemCode: 'WALLS', phrase: 'Feature wall, teal' });
    expect(created.statusCode).toBe(201);
    const phrase = created.json().phrase;
    expect(phrase).toMatchObject({ itemCode: 'WALLS', phrase: 'Feature wall, teal' });
    expect(phrase.sortOrder).toBeGreaterThan(0);
    const dup = await send('POST', '/api/admin/phrases', admin, { itemCode: 'WALLS', phrase: 'Feature wall, teal' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('DUPLICATE_PHRASE');
    expect((await get('/api/admin/phrases', admin)).json().phrases.some((p: { id: string }) => p.id === phrase.id)).toBe(true);
    expect((await get('/api/reference', officer)).json().phrases.some((p: { id: string }) => p.id === phrase.id)).toBe(true);
    expect((await send('DELETE', `/api/admin/phrases/${phrase.id}`, admin)).statusCode).toBe(204);
    expect((await send('DELETE', `/api/admin/phrases/${phrase.id}`, admin)).statusCode).toBe(404);
    expect((await get('/api/reference', officer)).json().phrases.some((p: { id: string }) => p.id === phrase.id)).toBe(false);
  });

  it('renames a scheme; the new name shows in /reference and the report wording', async () => {
    const res = await send('PATCH', '/api/admin/schemes/TF', admin, { name: 'Tenant Finder Service' });
    expect(res.statusCode).toBe(200);
    expect(res.json().scheme).toEqual({ code: 'TF', name: 'Tenant Finder Service' });
    const ref = (await get('/api/reference', officer)).json();
    expect(ref.schemes.find((s: { code: string }) => s.code === 'TF').name).toBe('Tenant Finder Service');
    expect((await send('PATCH', '/api/admin/schemes/XX', admin, { name: 'Nope Scheme' })).statusCode).toBe(400);

    const v = await send('POST', '/api/visits', officer, {
      id: uuidv7(), propertyId: await anyPropertyId(t), schemeCode: 'TF', visitType: 'check_in', presentRoomCodes: ['FRONT_DOOR'],
    });
    const preview = await get(`/api/visits/${v.json().visit.id}/preview`, officer);
    expect(preview.body).toContain('accuracy cannot be guaranteed by the Tenant Finder Service.');
  });

  it('summarises the published form', async () => {
    const f = (await get('/api/admin/form', admin)).json();
    expect(f.version).toBe(1);
    expect(f.rooms).toHaveLength(15);
    expect(f.totalItems).toBe(264);
    expect(f.conditionOptions.map((c: { code: string }) => c.code)).toEqual(['G', 'F', 'P', 'U', 'NA']);
    expect(f.itemColumns.at(-1)).toBe('PHOTO');
  });

  it('reports system status', async () => {
    const s = (await get('/api/admin/system', admin)).json();
    expect(s.db).toBe(true);
    expect(s.counts.users).toBeGreaterThanOrEqual(4);
    expect(s.counts.visits).toBeGreaterThan(0);
    expect(Object.keys(s.visitsByStatus).sort()).toEqual(['cancelled', 'completed', 'in_progress', 'issued', 'scheduled']);
    expect(s.jobs).toEqual({ queued: expect.any(Number), running: expect.any(Number), failed: expect.any(Number) });
    expect(Array.isArray(s.recentFailedJobs)).toBe(true);
  });

  it('lists audit events newest first with the actor name, filterable by entity', async () => {
    const b = await createVisit(t, officer);
    await push(t, officer, [mutation('item_record', b.items[0]!.id, { visitId: b.visit.id, condition: 'G', comment: 'ok' })]);
    const all = (await get('/api/admin/audit?limit=5', admin)).json().events;
    expect(all.length).toBeLessThanOrEqual(5);
    expect(all[0].id).toBeGreaterThan(all.at(-1).id);
    const items = (await get('/api/admin/audit?entity=item_record&limit=200', admin)).json().events;
    expect(items.every((e: { entity: string }) => e.entity === 'item_record')).toBe(true);
    expect(items.find((e: { entityId: string; field: string }) => e.entityId === b.items[0]!.id && e.field === 'comment')).toMatchObject({ actorName: 'P. Dekaate', newValue: 'ok', deviceId: 'device-a' });
    expect((await get('/api/admin/audit?limit=500', admin)).statusCode).toBe(400);
  });
});
