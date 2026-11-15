import { beforeEach, describe, expect, it } from 'vitest';
import { validate as uuidValidate, version as uuidVersion } from 'uuid';
import { db } from '../lib/db';
import { markAllGood, saveEdit } from '../lib/mutations';
import { parseAbbreviations } from '../lib/reference';
import { roomsForPropertyType } from '../lib/roomPlans';
import { sha256Hex, sha256Js } from '../lib/sha256';
import { setRoomPresent } from '../lib/visitFactory';
import { form, freshDb, seedVisit } from './helpers';

const f = form();
const ALL = f.rooms.map((r) => r.code);

beforeEach(async () => {
  await freshDb();
});

describe('offline visit creation (data-model.md "Visit creation")', () => {
  it('builds all 15 template rooms and 264 item rows when every room is present', async () => {
    const visitId = await seedVisit(f, ALL);
    const rooms = await db.rooms.where('visitId').equals(visitId).toArray();
    const items = await db.items.where('visitId').equals(visitId).toArray();
    expect(rooms).toHaveLength(15);
    expect(items).toHaveLength(264);
    expect(items.every((i) => i.condition === null && i.itemCode && i.roomInstanceId)).toBe(true);
    expect(await db.appliances.where('visitId').equals(visitId).count()).toBe(3);
    expect(await db.meters.where('visitId').equals(visitId).count()).toBe(4);
    const general = await db.general.where('visitId').equals(visitId).toArray();
    expect(Object.fromEntries(general.map((g) => [g.fieldCode, g.value]))).toEqual({ WINDOWS: 'UPVC Double Glazed', HEATING: 'Central Heating' });
    // Visits are not created through /sync/push: one queued POST /visits, no mutations.
    expect(await db.outbox.count()).toBe(0);
    const actions = await db.pendingActions.toArray();
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: 'createVisit', visitId, status: 'pending' });
    expect((actions[0]!.payload as { presentRoomCodes: string[] }).presentRoomCodes).toEqual(ALL);
    const visit = await db.visits.get(visitId);
    expect(visit).toMatchObject({ status: 'in_progress', schemeCode: 'PLS', reportNumber: null });
  });

  it('creates item rows only for present rooms; absent rooms exist with present=false', async () => {
    const plan = roomsForPropertyType(f, '2-bed flat');
    const visitId = await seedVisit(f, plan);
    const rooms = await db.rooms.where('visitId').equals(visitId).toArray();
    const items = await db.items.where('visitId').equals(visitId).toArray();
    expect(rooms).toHaveLength(15);
    expect(rooms.filter((r) => r.present).map((r) => r.roomCode).sort()).toEqual([...plan].sort());
    const expected = f.rooms.filter((r) => plan.includes(r.code)).reduce((n, r) => n + r.items.length, 0);
    expect(items).toHaveLength(expected);
    const absent = new Set(rooms.filter((r) => !r.present).map((r) => r.id));
    expect(items.some((i) => absent.has(i.roomInstanceId!))).toBe(false);
  });

  it('generates a room’s items the first time it is marked present', async () => {
    const visitId = await seedVisit(f, ['KITCHEN']);
    const utility = (await db.rooms.where('visitId').equals(visitId).toArray()).find((r) => r.roomCode === 'UTILITY')!;
    await setRoomPresent(f, utility, true, 0);
    const items = await db.items.where('roomInstanceId').equals(utility.id).count();
    expect(items).toBe(f.rooms.find((r) => r.code === 'UTILITY')!.items.length);
    expect((await db.rooms.get(utility.id))!.present).toBe(true);
  });
});

describe('outbox mutations', () => {
  it('an edit writes the row immediately and queues only the changed fields', async () => {
    const visitId = await seedVisit(f, ['KITCHEN']);
    await db.outbox.clear();
    const item = (await db.items.where('visitId').equals(visitId).first())!;

    await saveEdit('item_record', item.id, { description: 'Emulsion, white', qty: item.qty });

    expect((await db.items.get(item.id))!.description).toBe('Emulsion, white');
    const out = await db.outbox.toArray();
    expect(out).toHaveLength(1);
    const m = out[0]!;
    expect(m).toMatchObject({ entity: 'item_record', op: 'upsert', id: item.id, status: 'pending', attempts: 0 });
    expect(m.data).toEqual({ description: 'Emulsion, white', visitId }); // qty unchanged → not sent
    expect(uuidValidate(m.mutationId) && uuidVersion(m.mutationId)).toBe(7);
    expect(Date.parse(m.clientUpdatedAt)).not.toBeNaN();
    expect((await db.items.get(item.id))!.updatedAt).toBe(m.clientUpdatedAt);
  });

  it('a no-op edit queues nothing', async () => {
    const visitId = await seedVisit(f, ['KITCHEN']);
    await db.outbox.clear();
    const item = (await db.items.where('visitId').equals(visitId).first())!;
    expect(await saveEdit('item_record', item.id, { description: null })).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('the first edit to a scheduled visit also moves it to in_progress', async () => {
    const visitId = await seedVisit(f, ['KITCHEN']);
    await db.visits.update(visitId, { status: 'scheduled', startedAt: null });
    await db.outbox.clear();
    const item = (await db.items.where('visitId').equals(visitId).first())!;
    await saveEdit('item_record', item.id, { condition: 'G' });
    const out = await db.outbox.toArray();
    expect(out.map((m) => m.entity)).toEqual(['item_record', 'visit']);
    expect(out[1]!.data).toMatchObject({ status: 'in_progress' });
    expect((await db.visits.get(visitId))!.status).toBe('in_progress');
  });
});

describe('mark all as good', () => {
  it('only touches ungraded items in present rooms', async () => {
    const visitId = await seedVisit(f, ['KITCHEN', 'BATHROOM', 'UTILITY']);
    const rooms = await db.rooms.where('visitId').equals(visitId).toArray();
    const kitchen = rooms.find((r) => r.roomCode === 'KITCHEN')!;
    const utility = rooms.find((r) => r.roomCode === 'UTILITY')!;
    const kitchenItems = await db.items.where('roomInstanceId').equals(kitchen.id).sortBy('sortOrder');
    await saveEdit('item_record', kitchenItems[0]!.id, { condition: 'P', comment: 'Swollen worktop' });
    await saveEdit('item_record', kitchenItems[1]!.id, { condition: 'NA', naReason: 'Not fitted' });
    // Utility had items, then was marked not present: its items must stay ungraded.
    const utilityCount = await db.items.where('roomInstanceId').equals(utility.id).count();
    await setRoomPresent(f, utility, false, utilityCount);
    // A miscellaneous (no room) item is not part of "all rooms".
    await db.items.add({
      id: '0196f000-0000-7000-8000-00000000f001', visitId, roomInstanceId: null, itemCode: null, label: 'BOOKCASE', sortOrder: 0,
      qty: 1, description: null, condition: null, naReason: null, comment: null, dilapidation: null, updatedAt: new Date().toISOString(), updatedBy: null,
    });
    await db.outbox.clear();

    const n = await markAllGood(visitId);

    const bathroom = rooms.find((r) => r.roomCode === 'BATHROOM')!;
    const expected = kitchenItems.length - 2 + (await db.items.where('roomInstanceId').equals(bathroom.id).count());
    expect(n).toBe(expected);
    expect((await db.items.get(kitchenItems[0]!.id))!.condition).toBe('P');
    expect((await db.items.get(kitchenItems[1]!.id))!.condition).toBe('NA');
    expect((await db.items.where('roomInstanceId').equals(utility.id).toArray()).every((i) => i.condition === null)).toBe(true);
    expect((await db.items.get('0196f000-0000-7000-8000-00000000f001'))!.condition).toBeNull();
    const out = await db.outbox.toArray();
    expect(out).toHaveLength(expected);
    expect(out.every((m) => m.entity === 'item_record' && m.data.condition === 'G' && Object.keys(m.data).length === 2)).toBe(true);
    // Second press is a no-op.
    expect(await markAllGood(visitId)).toBe(0);
  });
});

describe('helpers', () => {
  it('pure-JS SHA-256 matches the standard vectors and crypto.subtle', async () => {
    const enc = new TextEncoder();
    expect(sha256Js(enc.encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Js(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    const big = enc.encode('x'.repeat(1000));
    expect(await sha256Hex(big)).toBe(sha256Js(big));
  });

  it('parses the template abbreviation key into quick-picks', () => {
    const abbr = parseAbbreviations(f.boilerplate.abbreviations).map((a) => a.code);
    expect(abbr).toEqual(['WP', 'PWE', 'PCE', 'PWG', 'DG', 'GWG', 'FWD', 'PWD', 'WF', 'CRP', 'LLWC', 'HLWC', 'O/S']);
  });
});
