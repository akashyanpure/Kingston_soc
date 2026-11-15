import { beforeEach, describe, expect, it } from 'vitest';
import type { Mutation, PushRequest, SyncEntity, VisitBundle } from '@soc/shared';
import { v7 as uuidv7 } from 'uuid';
import { setFetch } from '../lib/api';
import { db } from '../lib/db';
import { commit, saveEdit } from '../lib/mutations';
import { attachPhoto } from '../lib/photo';
import { orderForPush, SyncEngine } from '../lib/sync';
import { setRoomPresent } from '../lib/visitFactory';
import { form, freshDb, seedVisit } from './helpers';

const f = form();
const RANK: Record<SyncEntity, number> = {
  visit: 0, room_instance: 1, item_record: 2, visit_general: 3, appliance: 3, meter_reading: 3, additional_note: 3, photo: 4,
};

interface Call { method: string; path: string; body?: unknown; headers?: Record<string, string> }

/** A fake server: records calls, applies mutations idempotently, can drop the response of the first push. */
function fakeServer(opts: { loseFirstPushResponse?: boolean } = {}) {
  const calls: Call[] = [];
  const seen = new Set<string>();
  let pushes = 0;
  const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const path = input.replace(/^\/api/, '');
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body, headers: init?.headers as Record<string, string> });
    if (path === '/sync/push') {
      pushes++;
      const req = body as PushRequest;
      const results = req.mutations.map((m) => {
        const dup = seen.has(m.mutationId);
        seen.add(m.mutationId);
        return { mutationId: m.mutationId, status: dup ? 'duplicate' : 'applied' };
      });
      if (opts.loseFirstPushResponse && pushes === 1) throw new TypeError('Failed to fetch'); // applied, response lost
      return new Response(JSON.stringify({ results, serverTime: new Date().toISOString() }), { status: 200 });
    }
    if (method === 'PUT' && path.startsWith('/photos/')) return new Response(JSON.stringify({ photo: {} }), { status: 200 });
    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: path } }), { status: 404 });
  };
  return { calls, fetch, seen, pushed: () => calls.filter((c) => c.path === '/sync/push').flatMap((c) => (c.body as PushRequest).mutations) };
}

// Node's Blob (jsdom's cannot be structured-cloned into fake-indexeddb). Imported untyped: the app tsconfig has no Node types.
const nodeBuffer = 'node:buffer';
const { Blob: NodeBlob } = (await import(/* @vite-ignore */ nodeBuffer)) as { Blob: typeof Blob };
const jpeg = () => new NodeBlob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });

beforeEach(async () => {
  await freshDb();
});

/** A visit as if POST /visits had already succeeded (no pending create). */
async function syncedVisit(codes: string[]) {
  const visitId = await seedVisit(f, codes);
  await db.pendingActions.clear();
  return visitId;
}

describe('sync engine', () => {
  it('orders pushes visit → rooms → items → others → photos regardless of edit order', async () => {
    const visitId = await syncedVisit(['KITCHEN', 'BATHROOM']);
    const rooms = await db.rooms.where('visitId').equals(visitId).sortBy('sortOrder');
    const kitchen = rooms.find((r) => r.roomCode === 'KITCHEN')!;
    const item = (await db.items.where('roomInstanceId').equals(kitchen.id).first())!;
    // Edits made in "wrong" order: photo, meter, item, room, visit.
    await attachPhoto(visitId, { kind: 'item', roomInstanceId: kitchen.id, itemRecordId: item.id },
      { blob: jpeg(), width: 4, height: 3, bytes: 4, sha256: 'a'.repeat(64) },
      { stampText: 'X', capturedAt: new Date(), coords: null });
    const meter = (await db.meters.where('visitId').equals(visitId).first())!;
    await saveEdit('meter_reading', meter.id, { readingIn: '01234' });
    await saveEdit('item_record', item.id, { condition: 'P', comment: 'Swollen' });
    await saveEdit('room_instance', kitchen.id, { label: 'KITCHEN / DINER' });
    await saveEdit('visit', visitId, { scheduledAt: new Date().toISOString() });

    const server = fakeServer();
    setFetch(server.fetch);
    const engine = new SyncEngine();
    engine.pullEnabled = false;
    engine.batchSize = 2; // force several batches
    const res = await engine.runOnce();

    expect(res.error).toBeUndefined();
    const ranks = server.pushed().map((m: Mutation) => RANK[m.entity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(server.pushed().map((m) => m.entity)).toEqual(['visit', 'room_instance', 'item_record', 'meter_reading', 'photo']);
    expect(await db.outbox.count()).toBe(0);
    // Photo binary goes up after its row was accepted, with its hash.
    const put = server.calls.find((c) => c.method === 'PUT')!;
    expect(put.path).toMatch(/^\/photos\/.+\/file$/);
    expect(put.headers?.['x-sha256']).toBe('a'.repeat(64));
    expect(server.calls.indexOf(put)).toBeGreaterThan(server.calls.findIndex((c) => c.path === '/sync/push'));
    expect((await db.photos.toArray())[0]!.uploaded).toBe(true);
  });

  it('re-sends the same mutation ids after a lost response; the server dedupes them', async () => {
    const visitId = await syncedVisit(['KITCHEN']);
    const items = await db.items.where('visitId').equals(visitId).limit(3).toArray();
    for (const i of items) await saveEdit('item_record', i.id, { condition: 'G' });

    const server = fakeServer({ loseFirstPushResponse: true });
    setFetch(server.fetch);
    const engine = new SyncEngine();
    engine.pullEnabled = false;

    const first = await engine.runOnce();
    expect(first.error).toBeTruthy();
    expect(await db.outbox.count()).toBe(3); // nothing lost on the device
    expect((await db.outbox.toArray()).every((m) => m.attempts === 1)).toBe(true);

    const second = await engine.runOnce();
    expect(second.error).toBeUndefined();
    const pushes = server.calls.filter((c) => c.path === '/sync/push').map((c) => (c.body as PushRequest).mutations.map((m) => m.mutationId));
    expect(pushes).toHaveLength(2);
    expect(pushes[1]).toEqual(pushes[0]); // identical ids → idempotent on the server
    expect(await db.outbox.count()).toBe(0);
    engine.stop();
  });

  it('marks server-rejected mutations and keeps going', async () => {
    const visitId = await syncedVisit(['KITCHEN']);
    const [a, b] = await db.items.where('visitId').equals(visitId).limit(2).toArray();
    await saveEdit('item_record', a!.id, { condition: 'G' });
    await saveEdit('item_record', b!.id, { condition: 'G' });
    const rejectId = (await db.outbox.toArray())[0]!.mutationId;
    setFetch(async (_url, init) => {
      const req = JSON.parse(init!.body as string) as PushRequest;
      const results = req.mutations.map((m) => (m.mutationId === rejectId ? { mutationId: m.mutationId, status: 'rejected', error: 'Visit is issued' } : { mutationId: m.mutationId, status: 'applied' }));
      return new Response(JSON.stringify({ results, serverTime: new Date().toISOString() }));
    });
    const engine = new SyncEngine();
    engine.pullEnabled = false;
    const res = await engine.runOnce();
    expect(res).toMatchObject({ pushed: 1, rejected: 1 });
    expect(await db.outbox.toArray()).toMatchObject([{ mutationId: rejectId, status: 'rejected', error: 'Visit is issued' }]);
  });

  it('holds an offline-created visit back until POST /visits succeeds, then remaps to the server ids', async () => {
    const visitId = await seedVisit(f, ['KITCHEN']);
    const kitchen = (await db.rooms.where('visitId').equals(visitId).toArray()).find((r) => r.roomCode === 'KITCHEN')!;
    const item = (await db.items.where('roomInstanceId').equals(kitchen.id).first())!;
    await saveEdit('item_record', item.id, { condition: 'F', comment: 'Scuffed' });

    // The server builds the same visit with its own room/item ids.
    const serverRooms = (await db.rooms.where('visitId').equals(visitId).toArray()).map((r) => ({ ...r, id: uuidv7() }));
    const roomMap = new Map((await db.rooms.where('visitId').equals(visitId).toArray()).map((r, i) => [r.id, serverRooms[i]!.id]));
    const serverItems = (await db.items.where('visitId').equals(visitId).toArray()).map((i) => ({ ...i, id: uuidv7(), roomInstanceId: roomMap.get(i.roomInstanceId!)!, condition: null, comment: null }));
    const serverItem = serverItems.find((i) => i.itemCode === item.itemCode)!;
    const bundle: VisitBundle = {
      visit: (await db.visits.get(visitId))!, property: { id: (await db.visits.get(visitId))!.propertyId, uprn: null, addressLine1: '1 Test St', addressLine2: null, town: 'Kingston', postcode: 'KT1 1AA', propertyType: '1-bed flat', bedrooms: 1, landlordId: null },
      landlord: null, tenancy: null, general: [], appliances: [], meters: [], rooms: serverRooms, items: serverItems, photos: [], notes: [], report: null, signatures: [],
    };

    const pushed: Mutation[] = [];
    let posted = 0;
    let createOk = false;
    setFetch(async (url, init) => {
      if (url === '/api/visits' && init?.method === 'POST') {
        posted++;
        if (!createOk) throw new TypeError('Failed to fetch');
        return new Response(JSON.stringify(bundle), { status: 201 });
      }
      const req = JSON.parse(init!.body as string) as PushRequest;
      pushed.push(...req.mutations);
      return new Response(JSON.stringify({ results: req.mutations.map((m) => ({ mutationId: m.mutationId, status: 'applied' })), serverTime: new Date().toISOString() }));
    });
    const engine = new SyncEngine();
    engine.pullEnabled = false;

    await engine.runOnce(); // POST fails → nothing pushed
    expect(posted).toBe(1);
    expect(pushed).toHaveLength(0);

    createOk = true;
    const res = await engine.runOnce();
    expect(res.error).toBeUndefined();
    expect(pushed.map((m) => m.entity)).toEqual(['item_record']);
    expect(pushed[0]!.id).toBe(serverItem.id); // remapped to the server's id
    expect(pushed[0]!.data).toMatchObject({ condition: 'F', comment: 'Scuffed', visitId });
    const local = await db.items.get(serverItem.id);
    expect(local).toMatchObject({ condition: 'F', comment: 'Scuffed', roomInstanceId: roomMap.get(kitchen.id) });
    expect(await db.items.get(item.id)).toBeUndefined();
    engine.stop();
  });

  it("pushes a room's device-created items before its present=true, and photos with the rows that reference them", async () => {
    const visitId = await syncedVisit(['KITCHEN']);
    const utility = (await db.rooms.where('visitId').equals(visitId).toArray()).find((r) => r.roomCode === 'UTILITY')!;
    await setRoomPresent(f, utility, true, 0);
    const photoId = await attachPhoto(visitId, { kind: 'wide', roomInstanceId: utility.id },
      { blob: jpeg(), width: 4, height: 3, bytes: 4, sha256: 'b'.repeat(64) }, { stampText: 'X', capturedAt: new Date(), coords: null });
    const ordered = orderForPush(await db.outbox.toArray());
    const presentAt = ordered.findIndex((m) => m.entity === 'room_instance' && m.data.present === true);
    const lastItem = ordered.map((m) => m.entity).lastIndexOf('item_record');
    expect(presentAt).toBeGreaterThan(lastItem);

    const server = fakeServer();
    setFetch(server.fetch);
    const engine = new SyncEngine();
    engine.pullEnabled = false;
    engine.batchSize = 1;
    await engine.runOnce();
    const batches = server.calls.filter((c) => c.path === '/sync/push').map((c) => (c.body as PushRequest).mutations);
    const wideBatch = batches.find((b) => b.some((m) => m.data.widePhotoId === photoId))!;
    expect(wideBatch.map((m) => m.entity)).toEqual(['room_instance', 'photo']);
    expect(await db.outbox.count()).toBe(0);
    await commit([], []); // no-op commit is allowed
  });
});
