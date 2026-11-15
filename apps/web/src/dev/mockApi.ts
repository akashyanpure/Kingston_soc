/**
 * DEV ONLY — a tiny in-browser stand-in for apps/api so the UI can be exercised without
 * the backend: `VITE_MOCK_API=1 pnpm --filter @soc/web dev`. Off by default and never
 * bundled otherwise (main.tsx imports it behind a static env check). Follows the
 * contract in @soc/shared/api.ts loosely; it is not a reference implementation.
 * Toggle the browser's offline mode (DevTools → Network → Offline) to test sync:
 * the shim fails like a real network while navigator.onLine is false.
 */
import {
  buildFormDefinition, issueBlockers, SCHEMES,
  type CreateVisitRequest, type DescriptionPhrase, type Mutation, type PushRequest, type ReferenceData, type User, type VisitBundle, type VisitSummary,
} from '@soc/shared';
import { renderReportHtml } from '@soc/report';
import { v7 as uuidv7 } from 'uuid';
import { buildVisitCreates } from '../lib/visitFactory';
import { setFetch } from '../lib/api';

const KEY = 'soc-mock-api-v1';
const FORM_VERSION_ID = '0196f000-0000-7000-8000-000000000001';
const USERS: User[] = [
  { id: '0196f000-0000-7000-8000-0000000000a1', email: 'j.patel@kingston.gov.uk', name: 'J. Patel', role: 'officer', active: true },
  { id: '0196f000-0000-7000-8000-0000000000a2', email: 'r.manager@kingston.gov.uk', name: 'R. Okafor', role: 'manager', active: true },
];

type Rows = Record<string, Record<string, unknown>>;
interface State {
  me: string | null;
  properties: Rows;
  landlords: Rows;
  tables: Record<string, Rows>; // entity → id → row
  reports: Rows;
  signatures: Rows;
  processed: string[];
  seq: number;
}

const ENTITY_TABLE: Record<string, string> = {
  visit: 'visits', visit_general: 'general', appliance: 'appliances', meter_reading: 'meters',
  room_instance: 'rooms', item_record: 'items', photo: 'photos', additional_note: 'notes',
};

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as State;
  } catch { /* ignore */ }
  return seed();
}
function save(s: State) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

function seed(): State {
  const s: State = {
    me: null, properties: {}, landlords: {}, reports: {}, signatures: {}, processed: [], seq: 416,
    tables: Object.fromEntries(Object.values(ENTITY_TABLE).map((t) => [t, {}])),
  };
  const ll = { id: uuidv7(), name: 'A. Pemberton', company: 'Pemberton Lettings', email: 'lettings@example.org', phone: null };
  s.landlords[ll.id] = ll;
  const props = [
    { addressLine1: '14 Acre Road', postcode: 'KT2 6EU', propertyType: '3-bed house', bedrooms: 3 },
    { addressLine1: 'Flat 3, 22 Penrhyn Road', postcode: 'KT1 2BZ', propertyType: '1-bed flat', bedrooms: 1 },
  ].map((p) => ({ id: uuidv7(), uprn: null, addressLine2: null, town: 'Kingston upon Thames', landlordId: ll.id, ...p }));
  for (const p of props) s.properties[p.id] = p;
  const form = buildFormDefinition();
  const scheduled = new Date();
  scheduled.setHours(10, 30, 0, 0);
  createVisit(s, form, {
    id: uuidv7(), propertyId: props[0]!.id, schemeCode: 'PLS', visitType: 'check_in', scheduledAt: scheduled.toISOString(),
    presentRoomCodes: ['FRONT_GARDEN', 'BACK_GARDEN', 'FRONT_DOOR', 'HALLWAY', 'RECEPTION', 'KITCHEN', 'STAIRS_AND_LANDING', 'BEDROOM_1', 'BEDROOM_2', 'BEDROOM_3', 'BATHROOM'],
  }, USERS[0]!.id, 'scheduled');
  return s;
}

function createVisit(s: State, form: ReturnType<typeof buildFormDefinition>, req: CreateVisitRequest, officerId: string, status = 'in_progress') {
  const at = new Date().toISOString();
  for (const c of buildVisitCreates(form, { ...req, formVersionId: FORM_VERSION_ID, officerId }, at)) {
    const row = { ...c.row, updatedAt: at, updatedBy: officerId } as Record<string, unknown>;
    if (c.entity === 'visit') Object.assign(row, { status, startedAt: status === 'scheduled' ? null : at });
    s.tables[ENTITY_TABLE[c.entity]!]![c.row.id] = row;
  }
}

function bundle(s: State, visitId: string): VisitBundle | null {
  const visit = s.tables.visits![visitId];
  if (!visit) return null;
  const of = (t: string) => Object.values(s.tables[t]!).filter((r) => r.visitId === visitId);
  const property = s.properties[visit.propertyId as string]!;
  const report = Object.values(s.reports).find((r) => r.visitId === visitId) ?? null;
  return {
    visit, property, landlord: property.landlordId ? s.landlords[property.landlordId as string] ?? null : null, tenancy: null,
    general: of('general'), appliances: of('appliances'), meters: of('meters'), rooms: of('rooms'), items: of('items'),
    photos: of('photos'), notes: of('notes'), report,
    signatures: report ? Object.values(s.signatures).filter((x) => x.reportId === report.id) : [],
  } as unknown as VisitBundle;
}

function summary(s: State, b: VisitBundle): VisitSummary {
  const present = new Set(b.rooms.filter((r) => r.present).map((r) => r.id));
  const items = b.items.filter((i) => i.roomInstanceId === null || present.has(i.roomInstanceId));
  return {
    id: b.visit.id, schemeCode: b.visit.schemeCode, visitType: b.visit.visitType, status: b.visit.status, scheduledAt: b.visit.scheduledAt,
    reportNumber: b.visit.reportNumber, officerId: b.visit.officerId, updatedAt: b.visit.updatedAt,
    address: b.property.addressLine1, postcode: b.property.postcode,
    officerName: USERS.find((u) => u.id === b.visit.officerId)?.name ?? '',
    itemsTotal: items.length, itemsGraded: items.filter((i) => i.condition).length,
    defects: items.filter((i) => i.condition === 'F' || i.condition === 'P' || i.condition === 'U').length,
  };
}

const PHRASES: [string, string[]][] = [
  ['WALLS', ['Emulsion, magnolia', 'Emulsion, white', 'Lining paper, painted', 'Part-tiled']],
  ['CEILING', ['Smooth plaster, white', 'Artex, white', 'Coved, white']],
  ['WINDOW', ['UPVC double glazed, white', 'Timber sash, painted', 'Aluminium framed']],
  ['DOOR', ['Hardwood, painted white', 'Glazed panel', 'Flush, veneer', 'Fire door with closer']],
  ['RADIATOR', ['Single panel, white', 'Double panel, white', 'With TRV']],
  ['SMOKE_ALARM', ['Mains, interlinked', 'Battery, ceiling', 'Tested, sounded']],
  ['LIGHT_FITTING', ['Pendant with shade', 'Recessed LED downlight', 'Batten holder, no shade']],
  ['FLOORING', ['Laminate, oak effect', 'Carpet, grey', 'Vinyl, tile effect', 'Ceramic tile']],
];
function reference(): ReferenceData {
  const phrases: DescriptionPhrase[] = PHRASES.flatMap(([itemCode, list]) =>
    list.map((phrase, i) => ({ id: uuidv7(), itemCode, phrase, sortOrder: i })));
  return {
    formVersion: { id: FORM_VERSION_ID, version: 1, status: 'published', definition: buildFormDefinition(), publishedAt: '2026-11-15T09:00:00Z' },
    schemes: SCHEMES.map((x) => ({ code: x.code, name: x.name })),
    phrases,
    officers: USERS.map(({ id, name, role }) => ({ id, name, role })),
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const err = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) => json({ error: { code, message }, ...extra }, status);

async function handle(s: State, method: string, path: string, url: URL, init?: RequestInit): Promise<Response> {
  const body = () => (typeof init?.body === 'string' ? JSON.parse(init.body) : undefined);
  const me = USERS.find((u) => u.id === s.me) ?? null;
  let m: RegExpMatchArray | null;

  if (method === 'GET' && path === '/auth/dev-users') return json({ users: USERS });
  if (method === 'POST' && path === '/auth/dev-login') { s.me = body().userId; return json({ user: USERS.find((u) => u.id === s.me) }); }
  if (method === 'POST' && path === '/auth/login') {
    const u = USERS.find((x) => x.email === body().email.toLowerCase());
    if (!u) return err(401, 'UNAUTHORIZED', 'Invalid credentials');
    s.me = u.id;
    return json({ user: u });
  }
  if (!me) return err(401, 'UNAUTHORIZED', 'Sign in');
  if (method === 'POST' && path === '/auth/logout') { s.me = null; return new Response(null, { status: 204 }); }
  if (method === 'GET' && path === '/auth/me') return json({ user: me });
  if (method === 'GET' && path === '/reference') return json(reference());

  if (method === 'GET' && path === '/properties') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const properties = Object.values(s.properties)
      .filter((p) => `${p.addressLine1} ${p.postcode} ${p.uprn ?? ''}`.toLowerCase().includes(q))
      .map((p) => ({ ...p, landlord: p.landlordId ? s.landlords[p.landlordId as string] ?? null : null }));
    return json({ properties });
  }
  if (method === 'POST' && path === '/properties') {
    const { landlord, ...p } = body();
    if (s.properties[p.id]) return err(409, 'CONFLICT', 'Property exists');
    if (landlord) s.landlords[landlord.id] = landlord;
    s.properties[p.id] = p;
    return json({ property: p }, 201);
  }

  if (method === 'GET' && path === '/visits') {
    const all = Object.keys(s.tables.visits!).map((id) => bundle(s, id)!).filter((b) => me.role !== 'officer' || b.visit.officerId === me.id);
    const status = url.searchParams.get('status');
    return json({ visits: all.filter((b) => !status || b.visit.status === status).map((b) => summary(s, b)) });
  }
  if (method === 'POST' && path === '/visits') {
    const req = body() as CreateVisitRequest;
    if (s.tables.visits![req.id]) return json(bundle(s, req.id), 200); // idempotent on the device id
    createVisit(s, buildFormDefinition(), req, me.id);
    return json(bundle(s, req.id), 201);
  }
  if ((m = path.match(/^\/visits\/([^/]+)$/)) && method === 'GET') {
    const b = bundle(s, m[1]!);
    return b ? json(b) : err(404, 'NOT_FOUND', 'No such visit');
  }
  if ((m = path.match(/^\/visits\/([^/]+)\/issue$/)) && method === 'POST') {
    const b = bundle(s, m[1]!);
    if (!b) return err(404, 'NOT_FOUND', 'No such visit');
    if (b.report) return err(409, 'ALREADY_ISSUED', 'Already issued');
    const blockers = [
      ...issueBlockers(b),
      ...b.photos.filter((ph) => !ph.deletedAt && !ph.uploaded).map((ph) => ({ code: 'PHOTO_NOT_UPLOADED', message: 'Photo not uploaded yet.', photoId: ph.id })),
    ];
    if (blockers.length) return err(409, 'ISSUE_BLOCKED', 'Report cannot issue yet', { blockers });
    const report = {
      id: uuidv7(), visitId: b.visit.id, reportNumber: `SOC-${new Date().getFullYear()}-${String(++s.seq).padStart(4, '0')}`,
      sha256: 'f'.repeat(64), pdfReady: true, issuedAt: new Date().toISOString(), issuedBy: me.id,
    };
    s.reports[report.id] = report;
    Object.assign(s.tables.visits![b.visit.id]!, { status: 'issued', reportNumber: report.reportNumber, completedAt: report.issuedAt, updatedAt: report.issuedAt });
    return json({ report }, 201);
  }
  if ((m = path.match(/^\/reports\/([^/]+)$/)) && method === 'GET') {
    const report = s.reports[m[1]!];
    if (!report) return err(404, 'NOT_FOUND', 'No such report');
    return json({ report, signatures: Object.values(s.signatures).filter((x) => x.reportId === report.id) });
  }
  if ((m = path.match(/^\/reports\/([^/]+)\/signatures$/)) && method === 'POST') {
    const req = body();
    const signature = { id: uuidv7(), reportId: m[1], role: req.role, name: req.name, method: req.method, signedAt: new Date().toISOString(), reportSha256: null };
    s.signatures[signature.id] = signature;
    return json({ signature }, 201);
  }
  if ((m = path.match(/^\/reports\/([^/]+)\/pdf$/)) && method === 'GET') {
    const report = s.reports[m[1]!];
    const b = report && bundle(s, report.visitId as string);
    if (!b) return err(404, 'NOT_FOUND', 'No such report');
    const html = renderReportHtml({
      bundle: b, form: buildFormDefinition(), schemeName: SCHEMES.find((x) => x.code === b.visit.schemeCode)!.name,
      officerName: USERS.find((u) => u.id === b.visit.officerId)?.name ?? '', mode: 'final', photoSrc: () => '',
    });
    return new Response(html, { headers: { 'content-type': 'text/html' } });
  }

  if (method === 'POST' && path === '/sync/push') {
    const req = body() as PushRequest;
    const results = req.mutations.map((mu: Mutation) => {
      if (s.processed.includes(mu.mutationId)) return { mutationId: mu.mutationId, status: 'duplicate' as const };
      const table = s.tables[ENTITY_TABLE[mu.entity]!]!;
      const visitId = mu.entity === 'visit' ? mu.id : (mu.data.visitId as string);
      if (s.tables.visits![visitId]?.status === 'issued') return { mutationId: mu.mutationId, status: 'rejected' as const, error: 'Visit is issued' };
      table[mu.id] = { ...(table[mu.id] ?? {}), ...mu.data, id: mu.id, updatedAt: mu.clientUpdatedAt, updatedBy: me.id };
      if (mu.entity !== 'visit' && s.tables.visits![visitId]) s.tables.visits![visitId]!.updatedAt = mu.clientUpdatedAt;
      s.processed.push(mu.mutationId);
      return { mutationId: mu.mutationId, status: 'applied' as const };
    });
    return json({ results, serverTime: new Date().toISOString() });
  }
  if ((m = path.match(/^\/photos\/([^/]+)\/file$/)) && method === 'PUT') {
    const photo = s.tables.photos![m[1]!];
    if (!photo) return err(404, 'NOT_FOUND', 'Push the photo row first');
    photo.uploaded = true;
    return json({ photo });
  }
  if ((m = path.match(/^\/photos\/([^/]+)\/file$/)) && method === 'GET') return err(404, 'NOT_FOUND', 'Mock keeps no photo files');
  return err(404, 'NOT_FOUND', `Mock API has no ${method} ${path}`);
}

export function installMockApi(): void {
  const state = load();
  const real = globalThis.fetch.bind(globalThis);
  setFetch(async (input, init) => {
    const url = new URL(input, location.origin);
    if (!url.pathname.startsWith('/api/')) return real(input, init);
    if (!navigator.onLine) throw new TypeError('Failed to fetch (mock offline)');
    await new Promise((r) => setTimeout(r, 120));
    const res = await handle(state, (init?.method ?? 'GET').toUpperCase(), url.pathname.slice(4), url, init);
    save(state);
    return res;
  });
  console.info('%c[mock api] VITE_MOCK_API=1 — requests to /api are answered in the browser', 'color:#17708c');
}
