import { createHash, randomBytes } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { hash } from '@node-rs/argon2';
import { createTestDb, DEV_PASSWORD_DEFAULT, properties, SEED_OFFICER_EMAIL, users } from '@soc/db';
import type { TestDbHandle } from '@soc/db';
import { visitContentHash } from '@soc/shared';
import type { Mutation, SignatureRole, VisitBundle } from '@soc/shared';
import { buildApp } from '../src/app.js';
import type { App } from '../src/app.js';
import { MemoryMailer } from '../src/adapters/mail.js';
import { MemoryStorage } from '../src/adapters/storage.js';
import { testConfig } from '../src/config.js';
import type { Config } from '../src/config.js';
import { FakePdfRenderer } from '../src/pdf/renderer.js';
import type { PdfRenderer } from '../src/pdf/renderer.js';

export interface TestApp {
  app: App;
  handle: TestDbHandle;
  storage: MemoryStorage;
  mail: MemoryMailer;
  pdf: FakePdfRenderer;
  close: () => Promise<void>;
}

export async function setup(config: Partial<Config> = {}, renderer?: PdfRenderer): Promise<TestApp> {
  const handle = await createTestDb({ seed: true });
  // The seed has a single officer; add a second one to test that officers only see their own visits.
  await handle.db.insert(users).values({
    id: uuidv7(), email: 'second.officer@kingston.test', name: 'S. Officer', role: 'officer', active: true, passwordHash: await hash(DEV_PASSWORD_DEFAULT),
  });
  const storage = new MemoryStorage();
  const mail = new MemoryMailer();
  const pdf = new FakePdfRenderer();
  const app = await buildApp({ db: handle.db, storage, mail, pdf: renderer ?? pdf, config: testConfig(config) });
  await app.ready();
  return { app, handle, storage, mail, pdf, close: async () => { await app.close(); await handle.close(); } };
}

export const EMAILS = {
  admin: 'admin@kingston.test',
  manager: 'manager@kingston.test',
  officer: SEED_OFFICER_EMAIL,
  /** Not seeded: created by setup() for role-guard tests. */
  officer2: 'second.officer@kingston.test',
} as const;

/** Log in and return the Cookie header value. */
export async function login(t: TestApp, who: keyof typeof EMAILS): Promise<string> {
  const res = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: EMAILS[who], password: DEV_PASSWORD_DEFAULT } });
  if (res.statusCode !== 200) throw new Error(`login failed ${res.statusCode} ${res.body}`);
  const c = res.cookies.find((x) => x.name === 'soc_session');
  if (!c) throw new Error('no session cookie');
  return `soc_session=${c.value}`;
}

export async function userId(t: TestApp, who: keyof typeof EMAILS): Promise<string> {
  const [u] = await t.handle.db.select({ id: users.id }).from(users).where(eq(users.email, EMAILS[who]));
  return u!.id;
}

export async function anyPropertyId(t: TestApp): Promise<string> {
  const [p] = await t.handle.db.select({ id: properties.id }).from(properties).limit(1);
  return p!.id;
}

export async function createVisit(t: TestApp, cookie: string, presentRoomCodes = ['FRONT_DOOR']): Promise<VisitBundle> {
  const res = await t.app.inject({
    method: 'POST', url: '/api/visits', headers: { cookie },
    payload: { id: uuidv7(), propertyId: await anyPropertyId(t), schemeCode: 'PLS', visitType: 'check_in', presentRoomCodes },
  });
  if (res.statusCode !== 201) throw new Error(`create visit failed ${res.statusCode} ${res.body}`);
  return res.json() as VisitBundle;
}

let clock = Date.parse('2026-11-15T10:00:00Z');
/** Monotonic client timestamps. */
export const tick = (ms = 1000) => new Date((clock += ms)).toISOString();

export function mutation(entity: Mutation['entity'], id: string, data: Record<string, unknown>, clientUpdatedAt = tick(), op: Mutation['op'] = 'upsert'): Mutation {
  return { mutationId: uuidv7(), entity, op, id, data, clientUpdatedAt };
}

export async function push(t: TestApp, cookie: string, mutations: Mutation[], deviceId = 'device-a') {
  const res = await t.app.inject({ method: 'POST', url: '/api/sync/push', headers: { cookie }, payload: { deviceId, mutations } });
  if (res.statusCode !== 200) throw new Error(`push failed ${res.statusCode} ${res.body}`);
  return res.json() as { results: { mutationId: string; status: string; error?: string }[]; serverTime: string };
}

export function fakeJpeg(): { bytes: Buffer; sha256: string } {
  const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(256), Buffer.from([0xff, 0xd9])]);
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export function photoRow(visitId: string, sha256: string, extra: Record<string, unknown> = {}) {
  return {
    visitId, roomInstanceId: null, itemRecordId: null, capturedAt: tick(), lat: 51.41, lng: -0.3,
    stampText: '14 ACRE ROAD, KT2 6EU', sha256, bytes: 262, width: 1600, height: 1200, deletedAt: null, ...extra,
  };
}

export async function uploadPhoto(t: TestApp, cookie: string, id: string, bytes: Buffer, sha: string): Promise<LightMyRequestResponse> {
  return t.app.inject({ method: 'PUT', url: `/api/photos/${id}/file`, headers: { cookie, 'content-type': 'image/jpeg', 'x-sha256': sha }, payload: bytes });
}

/** Fill a visit so it can be issued: general fields, wide photo per present room, all items graded (first one F with photo). */
export async function completeVisit(t: TestApp, cookie: string, b: VisitBundle, jpeg: () => { bytes: Buffer; sha256: string } = fakeJpeg, opts: { sign?: boolean } = {}) {
  const vid = b.visit.id;
  const g = (code: string) => b.general.find((x) => x.fieldCode === code)!;
  const muts: Mutation[] = [
    mutation('visit_general', g('DESCRIPTION_OF_PROPERTY').id, { visitId: vid, value: 'Terraced house' }),
    mutation('visit_general', g('GENERAL_CONDITION').id, { visitId: vid, value: 'Good' }),
  ];
  const uploads: { id: string; bytes: Buffer; sha256: string }[] = [];
  for (const room of b.rooms.filter((r) => r.present)) {
    const items = b.items.filter((i) => i.roomInstanceId === room.id);
    const wide = { id: uuidv7(), ...jpeg() };
    const defect = { id: uuidv7(), ...jpeg() };
    uploads.push(wide, defect);
    muts.push(
      mutation('photo', wide.id, photoRow(vid, wide.sha256, { roomInstanceId: room.id })),
      mutation('photo', defect.id, photoRow(vid, defect.sha256, { roomInstanceId: room.id, itemRecordId: items[0]!.id })),
      mutation('room_instance', room.id, { visitId: vid, widePhotoId: wide.id }),
      mutation('item_record', items[0]!.id, { visitId: vid, condition: 'F', comment: 'Scuffed' }),
      ...items.slice(1).map((i) => mutation('item_record', i.id, { visitId: vid, condition: 'G' })),
    );
  }
  const r = await push(t, cookie, muts);
  if (!r.results.every((x) => x.status === 'applied')) throw new Error(`push failed: ${JSON.stringify(r.results.filter((x) => x.status !== 'applied'))}`);
  for (const u of uploads) {
    const res = await uploadPhoto(t, cookie, u.id, u.bytes, u.sha256);
    if (res.statusCode !== 200) throw new Error(`upload failed ${res.body}`);
  }
  if (opts.sign !== false) {
    const s = await sign(t, cookie, vid);
    if (s.result.status !== 'applied') throw new Error(`sign failed: ${JSON.stringify(s.result)}`);
  }
}

/** 1×1 PNG as a data URL (finger-signature stand-in). */
export const SIGNATURE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export async function getBundle(t: TestApp, cookie: string, visitId: string): Promise<VisitBundle> {
  const res = await t.app.inject({ method: 'GET', url: `/api/visits/${visitId}`, headers: { cookie } });
  if (res.statusCode !== 200) throw new Error(`get bundle failed ${res.statusCode} ${res.body}`);
  return res.json() as VisitBundle;
}

/** E-sign the current draft on the "device": contentSha256 = visitContentHash(current bundle). */
export async function sign(
  t: TestApp, cookie: string, visitId: string,
  opts: { id?: string; role?: SignatureRole; name?: string; image?: string | null } = {},
) {
  const b = await getBundle(t, cookie, visitId);
  const id = opts.id ?? uuidv7();
  const data: Record<string, unknown> = {
    visitId, role: opts.role ?? 'officer', name: opts.name ?? 'P. Dekaate', method: 'on_device', signedAt: tick(), contentSha256: visitContentHash(b),
  };
  if (opts.image !== null) data.imageDataUrl = opts.image ?? SIGNATURE_PNG;
  const r = await push(t, cookie, [mutation('signature', id, data)]);
  return { id, result: r.results[0]! };
}
