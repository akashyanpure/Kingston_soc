import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signingLinks } from '@soc/db';
import type { ManagerOverview, SigningLink, SigningView } from '@soc/shared';
import { processNextJob } from '../src/pdf/worker.js';
import { SIGNATURE_PNG, completeVisit, createVisit, getBundle, login, setup } from './helpers.js';
import type { TestApp } from './helpers.js';

let t: TestApp;
let officer: string;
let manager: string;
beforeAll(async () => {
  t = await setup();
  [officer, manager] = await Promise.all([login(t, 'officer'), login(t, 'manager')]);
});
afterAll(async () => {
  await t?.close();
});

const get = (url: string, cookie?: string) => t.app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });
const post = (url: string, payload: unknown, cookie?: string) =>
  t.app.inject({ method: 'POST', url, headers: cookie ? { cookie } : {}, payload: payload as object });

/** Issue a complete visit; render its PDF unless render=false. */
async function issuedReport(render = true) {
  const b = await createVisit(t, officer, ['FRONT_DOOR']);
  await completeVisit(t, officer, b);
  const res = await post(`/api/visits/${b.visit.id}/issue`, {}, officer);
  if (res.statusCode !== 201) throw new Error(res.body);
  if (render) await processNextJob(t.app.ctx);
  const report = (await get(`/api/reports/${res.json().report.id}`, officer)).json().report;
  return { bundle: await getBundle(t, officer, b.visit.id), report };
}

async function newLink(reportId: string, payload: Record<string, unknown> = { role: 'landlord_agent' }, cookie = officer) {
  const res = await post(`/api/reports/${reportId}/signing-links`, payload, cookie);
  if (res.statusCode !== 201) throw new Error(`${res.statusCode} ${res.body}`);
  const { link, url } = res.json() as { link: SigningLink; url: string };
  return { link, url, token: url.split('/sign/')[1]! };
}

describe('signing links (staff)', () => {
  it('creates, emails, lists, and keeps one pending link per role', async () => {
    const { report, bundle } = await issuedReport();
    const before = t.mail.sent.length;
    const res = await post(`/api/reports/${report.id}/signing-links`, { role: 'landlord_agent', recipientName: 'A. Pemberton', recipientEmail: 'a.p@example.org' }, officer);
    expect(res.statusCode).toBe(201);
    const { link, url } = res.json();
    expect(url).toMatch(/^http:\/\/localhost:5173\/sign\/[A-Za-z0-9_-]{43}$/);
    expect(link).toMatchObject({ reportId: report.id, role: 'landlord_agent', status: 'pending', recipientEmail: 'a.p@example.org', openedAt: null, disputes: 0 });
    const mail = t.mail.sent[before]!;
    expect(mail.to).toEqual(['a.p@example.org']);
    expect(mail.subject).toBe(`Please check and sign: Schedule of Condition ${report.reportNumber}`);
    expect(mail.text).toContain(url);
    expect(mail.text).toContain(bundle.property.postcode);
    // The raw token is never stored.
    const rows = await t.handle.db.select().from(signingLinks).where(eq(signingLinks.id, link.id));
    expect(rows[0]!.tokenHash).not.toBe(url.split('/sign/')[1]);

    const second = await newLink(report.id, { role: 'landlord_agent' }, manager);
    await newLink(report.id, { role: 'tenant_check_in' });
    const links = (await get(`/api/reports/${report.id}/signing-links`, officer)).json().links as SigningLink[];
    expect(links.map((l) => [l.role, l.status])).toEqual([['landlord_agent', 'revoked'], ['landlord_agent', 'pending'], ['tenant_check_in', 'pending']]);
    expect(links[1]!.id).toBe(second.link.id);

    // Officer (role) guard on signing-links/officer is not a link role → 400; other officer 403; anonymous 401.
    expect((await post(`/api/reports/${report.id}/signing-links`, { role: 'officer' }, officer)).statusCode).toBe(400);
    const other = await login(t, 'officer2');
    expect((await get(`/api/reports/${report.id}/signing-links`, other)).statusCode).toBe(403);
    expect((await get(`/api/reports/${report.id}/signing-links`)).statusCode).toBe(401);
    expect((await get(`/api/reports/${report.id}/disputes`, other)).statusCode).toBe(403);
  });

  it('refuses links until the PDF is ready', async () => {
    const { report } = await issuedReport(false);
    const res = await post(`/api/reports/${report.id}/signing-links`, { role: 'landlord_agent' }, officer);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('REPORT_NOT_READY');
    await processNextJob(t.app.ctx); // leave the queue clean
  });
});

describe('signing links (public)', () => {
  it('shows the signing view (no session) and records the first open', async () => {
    const { report, bundle } = await issuedReport();
    const { link, token } = await newLink(report.id, { role: 'landlord_agent', recipientName: 'A. Pemberton' });
    const res = await get(`/api/sign/${token}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const view = res.json() as SigningView;
    expect(view).toMatchObject({
      status: 'pending', role: 'landlord_agent', recipientName: 'A. Pemberton', reportNumber: report.reportNumber,
      schemeName: 'Private Leasing Scheme', postcode: bundle.property.postcode, officerName: 'P. Dekaate', pdfReady: true,
    });
    expect(view.stats).toEqual({ items: 10, belowGood: 1, photos: 2 });
    expect(view.belowGood).toHaveLength(1);
    expect(view.belowGood[0]).toMatchObject({ room: 'FRONT DOOR', condition: 'F', comment: 'Scuffed', disputed: false });
    expect(view.belowGood[0]!.photoIds).toHaveLength(1);
    expect(view.signedBy.map((s) => s.role)).toEqual(['officer']);
    const opened = (await get(`/api/reports/${report.id}/signing-links`, officer)).json().links.find((l: SigningLink) => l.id === link.id);
    expect(opened.openedAt).not.toBeNull();

    const pdf = await get(`/api/sign/${token}/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const photo = await get(`/api/sign/${token}/photos/${view.belowGood[0]!.photoIds[0]}`);
    expect(photo.statusCode).toBe(200);
    expect(photo.headers['content-type']).toBe('image/jpeg');
  });

  it('refuses photos of other reports, unknown and malformed tokens', async () => {
    const a = await issuedReport();
    const b = await issuedReport();
    const { token } = await newLink(a.report.id);
    const otherPhoto = b.bundle.photos[0]!.id;
    expect((await get(`/api/sign/${token}/photos/${otherPhoto}`)).statusCode).toBe(404);
    expect((await get(`/api/sign/${token}/photos/${uuidv7()}`)).statusCode).toBe(404);
    expect((await get(`/api/sign/${'A'.repeat(43)}`)).statusCode).toBe(404);
    expect((await get('/api/sign/short')).statusCode).toBe(404);
  });

  it('returns 410 for revoked, expired and used links', async () => {
    const { report } = await issuedReport();
    const revoked = await newLink(report.id, { role: 'tenant_check_in' });
    const rv = await post(`/api/signing-links/${revoked.link.id}/revoke`, {}, officer);
    expect(rv.statusCode).toBe(200);
    expect(rv.json().link.status).toBe('revoked');
    const r1 = await get(`/api/sign/${revoked.token}`);
    expect(r1.statusCode).toBe(410);
    expect(r1.json().error.code).toBe('LINK_REVOKED');

    const expired = await newLink(report.id, { role: 'tenant_check_in' });
    await t.handle.db.update(signingLinks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(signingLinks.id, expired.link.id));
    expect((await get(`/api/sign/${expired.token}`)).json().error.code).toBe('LINK_EXPIRED');
    expect((await post(`/api/sign/${expired.token}`, { name: 'T. Tenant', imageDataUrl: SIGNATURE_PNG, confirm: true })).statusCode).toBe(410);

    const used = await newLink(report.id);
    expect((await post(`/api/sign/${used.token}`, { name: 'A. Pemberton', imageDataUrl: SIGNATURE_PNG, confirm: true })).statusCode).toBe(201);
    expect((await get(`/api/sign/${used.token}`)).json().error.code).toBe('LINK_USED');
    const again = await post(`/api/signing-links/${used.link.id}/revoke`, {}, officer);
    expect(again.statusCode).toBe(409);
  });

  it('signing records a link signature bound to the PDF hash and clears the manager "unsigned" item', async () => {
    const { report, bundle } = await issuedReport();
    const unsignedBefore = (await get('/api/manage/overview', manager)).json() as ManagerOverview;
    expect(unsignedBefore.unsigned.some((u) => u.reportId === report.id)).toBe(true);

    const { token } = await newLink(report.id, { role: 'landlord_agent' });
    expect((await post(`/api/sign/${token}`, { name: 'A. Pemberton', imageDataUrl: SIGNATURE_PNG })).statusCode).toBe(400); // confirm required
    expect((await post(`/api/sign/${token}`, { name: 'A. Pemberton', imageDataUrl: 'data:image/png;base64,bm90cG5n', confirm: true })).statusCode).toBe(400);
    const mailsBefore = t.mail.sent.length;
    const res = await post(`/api/sign/${token}`, { name: 'A. Pemberton', imageDataUrl: SIGNATURE_PNG, confirm: true });
    expect(res.statusCode).toBe(201);
    const sig = res.json().signature;
    expect(sig).toMatchObject({ role: 'landlord_agent', method: 'link', name: 'A. Pemberton', reportId: report.id, reportSha256: report.sha256, hasImage: true });
    expect(t.mail.sent.slice(mailsBefore).some((m) => m.to.includes('p.dekaate@kingston.test') && m.subject.startsWith('Signed:'))).toBe(true);

    const meta = (await get(`/api/reports/${report.id}`, officer)).json();
    expect(meta.signatures.find((s: { id: string }) => s.id === sig.id)).toMatchObject({ method: 'link', reportSha256: report.sha256 });
    expect((await get(`/api/signatures/${sig.id}/image`, officer)).statusCode).toBe(200);
    const after = (await get('/api/manage/overview', manager)).json() as ManagerOverview;
    expect(after.unsigned.some((u) => u.reportId === report.id)).toBe(false);
    expect(after.kpis.unsignedByLandlord).toBe(unsignedBefore.kpis.unsignedByLandlord - 1);

    // Role already signed → no new link.
    const dup = await post(`/api/reports/${report.id}/signing-links`, { role: 'landlord_agent' }, officer);
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('ALREADY_SIGNED');
    // The issued PDF is unchanged (immutability) — the visit bundle still says issued.
    expect((await getBundle(t, officer, bundle.visit.id)).visit.status).toBe('issued');
  });

  it('disputes an item, emails the officer and shows in the staff list', async () => {
    const { report } = await issuedReport();
    const other = await issuedReport();
    const { link, token } = await newLink(report.id, { role: 'landlord_agent', recipientName: 'A. Pemberton' });
    const view = (await get(`/api/sign/${token}`)).json() as SigningView;
    const itemId = view.belowGood[0]!.itemRecordId;
    const mailsBefore = t.mail.sent.length;
    const res = await post(`/api/sign/${token}/disputes`, { itemRecordId: itemId, comment: 'This scuff was there before; see the 2024 inventory.' });
    expect(res.statusCode).toBe(201);
    expect(res.json().dispute).toMatchObject({ reportId: report.id, signingLinkId: link.id, itemRecordId: itemId, room: 'FRONT DOOR', resolvedAt: null });
    const mail = t.mail.sent.slice(mailsBefore).find((m) => m.subject.startsWith('Item disputed'))!;
    expect(mail.to).toEqual(['p.dekaate@kingston.test']);
    expect(mail.text).toContain('This scuff was there before');

    expect((await post(`/api/sign/${token}/disputes`, { itemRecordId: other.bundle.items[0]!.id, comment: 'Not my report item' })).statusCode).toBe(404);
    expect((await post(`/api/sign/${token}/disputes`, { itemRecordId: itemId, comment: 'x' })).statusCode).toBe(400);
    const list = (await get(`/api/reports/${report.id}/disputes`, manager)).json().disputes;
    expect(list).toHaveLength(1);
    expect((await get(`/api/sign/${token}`)).json().belowGood[0].disputed).toBe(true);
    expect((await get(`/api/reports/${report.id}/signing-links`, officer)).json().links[0].disputes).toBe(1);
  });
});

describe('manager CSV + preview', () => {
  it('exports visits as CSV with the agreed columns', async () => {
    const res = await get('/api/manage/visits.csv', manager);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="soc-visits-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv"/);
    const lines = res.body.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('date,time,address,postcode,scheme,visit type,officer,status,items graded,items total,defects,report number');
    expect(lines.length).toBeGreaterThan(1); // seeded visits are scheduled today
    expect(lines.slice(1).some((l) => l.includes('P. Dekaate') && l.includes('Scheduled'))).toBe(true);
    expect((await get('/api/manage/visits.csv', officer)).statusCode).toBe(403);
  });

  it('lets managers and admins open any visit preview; summaries include propertyId', async () => {
    const b = await createVisit(t, officer);
    const admin = await login(t, 'admin');
    for (const c of [manager, admin]) {
      const res = await get(`/api/visits/${b.visit.id}/preview`, c);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
    }
    const summaries = (await get('/api/visits', manager)).json().visits;
    expect(summaries.find((v: { id: string }) => v.id === b.visit.id).propertyId).toBe(b.property.id);
  });
});

describe('rate limits', () => {
  it('limits public signing requests per IP and login attempts per IP+email', async () => {
    const limited = await setup({ signRateLimit: 3, loginRateLimit: 2 });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 4; i++) codes.push((await limited.app.inject({ method: 'GET', url: `/api/sign/${'B'.repeat(43)}` })).statusCode);
      expect(codes).toEqual([404, 404, 404, 429]);
      const bad = () => limited.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@kingston.test', password: 'wrong-password' } });
      expect((await bad()).statusCode).toBe(401);
      expect((await bad()).statusCode).toBe(401);
      const blocked = await bad();
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().error.code).toBe('TOO_MANY_ATTEMPTS');
      expect(blocked.headers['retry-after']).toBeDefined();
      // A different email from the same IP is not blocked.
      const other = await limited.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'manager@kingston.test', password: 'Password123!local' } });
      expect(other.statusCode).toBe(200);
    } finally {
      await limited.close();
    }
  });
});
