import { beforeEach, describe, expect, it } from 'vitest';
import { issueBlockers, type PushRequest } from '@soc/shared';
import { setFetch } from '../lib/api';
import { db } from '../lib/db';
import { createRow, markAllGood, newId, saveEdit } from '../lib/mutations';
import { attachPhoto } from '../lib/photo';
import { contentHashOf, isStale, rolesFor, signVisit } from '../lib/signatures';
import { queueIssue, SyncEngine } from '../lib/sync';
import { loadVisit } from '../lib/visitData';
import { form, freshDb, seedVisit } from './helpers';

const f = form();
const nodeBuffer = 'node:buffer';
const { Blob: NodeBlob } = (await import(/* @vite-ignore */ nodeBuffer)) as { Blob: typeof Blob };
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

beforeEach(async () => {
  await freshDb();
});

/** A visit whose content is complete (no content blockers): one room, all Good, wide photo, general filled. */
async function completeVisit() {
  const visitId = await seedVisit(f, ['SEPARATE_WC']);
  await db.pendingActions.clear(); // as if POST /visits already succeeded
  const room = (await db.rooms.where('visitId').equals(visitId).toArray()).find((r) => r.present)!;
  await markAllGood(visitId);
  await attachPhoto(visitId, { kind: 'wide', roomInstanceId: room.id },
    { blob: new NodeBlob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), width: 4, height: 3, bytes: 3, sha256: 'c'.repeat(64) },
    { stampText: 'X', capturedAt: new Date(), coords: null });
  for (const fieldCode of ['DESCRIPTION_OF_PROPERTY', 'GENERAL_CONDITION'])
    await createRow('visit_general', { id: newId(), visitId, fieldCode, value: 'Good order' });
  return visitId;
}

async function blockersOf(visitId: string) {
  const d = (await loadVisit(visitId))!;
  return issueBlockers({
    rooms: d.rooms, items: d.items, photos: d.photos, general: d.general,
    signatures: d.signatures, visitType: d.visit.visitType, contentSha256: contentHashOf(d)!,
  });
}

describe('e-signatures before issue', () => {
  it('signing writes a Signature row and queues a mutation with the content hash and the image', async () => {
    const visitId = await completeVisit();
    expect((await blockersOf(visitId)).map((b) => b.code)).toEqual(['OFFICER_SIGNATURE_MISSING']);
    await db.outbox.clear();

    const id = await signVisit(visitId, 'officer', 'P. Dekaate', PNG);

    const hash = contentHashOf((await loadVisit(visitId))!);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    const row = (await db.signatures.get(id))!;
    expect(row).toMatchObject({ visitId, role: 'officer', name: 'P. Dekaate', method: 'on_device', contentSha256: hash, hasImage: true, reportId: null, imageDataUrl: PNG });
    const out = await db.outbox.toArray();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ entity: 'signature', op: 'upsert', id });
    expect(out[0]!.data).toMatchObject({ visitId, role: 'officer', method: 'on_device', contentSha256: hash, imageDataUrl: PNG });
    expect(await blockersOf(visitId)).toEqual([]);
  });

  it('editing the content after signing makes the signature stale and blocks issue; re-signing updates the same row', async () => {
    const visitId = await completeVisit();
    const id = await signVisit(visitId, 'officer', 'P. Dekaate', PNG);
    const item = (await db.items.where('visitId').equals(visitId).first())!;

    await saveEdit('item_record', item.id, { description: 'Low level cistern' });

    const d = (await loadVisit(visitId))!;
    expect(isStale(d.signatures[0]!, contentHashOf(d))).toBe(true);
    expect((await blockersOf(visitId)).map((b) => b.code)).toEqual(['SIGNATURE_STALE']);

    await db.outbox.clear();
    expect(await signVisit(visitId, 'officer', 'P. Dekaate', PNG.replace('=', 'A='))).toBe(id);
    expect(await db.signatures.count()).toBe(1);
    const out = await db.outbox.toArray();
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe(id);
    expect(Object.keys(out[0]!.data).sort()).toEqual(['contentSha256', 'imageDataUrl', 'signedAt', 'visitId']);
    expect(await blockersOf(visitId)).toEqual([]);
  });

  it('offers only the roles valid for the visit type', () => {
    expect(rolesFor(f, 'check_in').map((r) => r.role)).toEqual(['landlord_agent', 'officer', 'tenant_check_in']);
    expect(rolesFor(f, 'check_out').map((r) => r.role)).toEqual(['landlord_agent', 'officer', 'tenant_check_out']);
    expect(rolesFor(f, 'interim').map((r) => r.role)).toEqual(['landlord_agent', 'officer']);
  });

  it('a queued issue waits until the signature mutations have been accepted', async () => {
    const visitId = await completeVisit();
    await signVisit(visitId, 'officer', 'P. Dekaate', PNG);
    await db.photos.toCollection().modify({ uploaded: true }); // photo files already on the server
    await queueIssue(visitId);

    const calls: string[] = [];
    let pushedEntities: string[] = [];
    setFetch(async (url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url === '/api/sync/push') {
        const req = JSON.parse(init!.body as string) as PushRequest;
        pushedEntities = req.mutations.map((m) => m.entity);
        return new Response(JSON.stringify({ results: req.mutations.map((m) => ({ mutationId: m.mutationId, status: 'applied' })), serverTime: new Date().toISOString() }));
      }
      if (url === `/api/visits/${visitId}/issue`) {
        return new Response(JSON.stringify({ report: { id: newId(), visitId, reportNumber: 'SOC-2026-0001', sha256: null, pdfReady: false, issuedAt: new Date().toISOString(), issuedBy: newId() } }), { status: 201 });
      }
      return new Response('{}', { status: 404 });
    });
    const engine = new SyncEngine();
    engine.pullEnabled = false;

    // Signature still in the outbox → the issue action must not run.
    expect(await engine.runIssueActions()).toBe(0);
    expect(calls).toEqual([]);

    const res = await engine.runOnce();
    expect(res.error).toBeUndefined();
    expect(pushedEntities[pushedEntities.length - 1]).toBe('signature'); // signatures go last, after the content
    const push = calls.indexOf('POST /api/sync/push');
    const issue = calls.indexOf(`POST /api/visits/${visitId}/issue`);
    expect(push).toBeGreaterThanOrEqual(0);
    expect(issue).toBeGreaterThan(push);
    expect(calls.some((c) => c.includes('/signatures'))).toBe(false); // no post-issue signature calls
    expect((await db.visits.get(visitId))).toMatchObject({ status: 'issued', reportNumber: 'SOC-2026-0001' });
    expect((await db.pendingActions.toArray()).find((a) => a.kind === 'issue')!.status).toBe('done');
  });
});
