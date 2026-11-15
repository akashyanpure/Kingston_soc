/**
 * DEV ONLY — an in-browser stand-in for apps/api so the UI can be exercised without the
 * backend: `VITE_MOCK_API=1 pnpm --filter @soc/web dev`. Off by default and never bundled
 * otherwise (main.tsx imports it behind a static env check). It follows the contract in
 * @soc/shared (api.ts, roles.ts) loosely; it is not a reference implementation.
 *
 * Seeded with a realistic week: three officers, a manager and an admin, ~20 visits in every
 * status, issued reports (some without a landlord signature), Unacceptable items, phrases,
 * an audit trail and a PDF job queue. State persists in localStorage (key below).
 * Toggle the browser offline to test sync: the shim fails like a real network.
 */
import {
  buildFormDefinition, issueBlockers, normalisePostcode, SCHEMES, visitContentHash, type PostcodeLookup,
  type AuditEvent, type CreatePhraseRequest, type CreateUserRequest, type CreateVisitRequest, type DescriptionPhrase,
  type FormSummary, type ManagerOverview, type Mutation, type PushRequest, type ReferenceData, type ReportSummary,
  type SystemStatus, type UpdateUserRequest, type User, type VisitBundle, type VisitSummary,
  type CreateSigningLinkRequest, type PublicDisputeRequest, type PublicSignRequest, type SigningLink, type SigningView, SIGNING_LINK_DAYS,
} from '@soc/shared';
import { renderReportHtml } from '@soc/report';
import { v7 as uuidv7 } from 'uuid';
import { buildVisitCreates } from '../lib/visitFactory';
import { setFetch } from '../lib/api';

const KEY = 'soc-mock-api-v4';
const FORM_VERSION_ID = '0196f000-0000-7000-8000-000000000001';
const FORM = buildFormDefinition();
const STARTED_AT = Date.now();

const SEED_USERS: User[] = [
  { id: '0196f000-0000-7000-8000-0000000000a1', email: 'p.dekaate@kingston.test', name: 'P. Dekaate', role: 'officer', active: true },
  { id: '0196f000-0000-7000-8000-0000000000a3', email: 's.ahmed@kingston.test', name: 'S. Ahmed', role: 'officer', active: true },
  { id: '0196f000-0000-7000-8000-0000000000a4', email: 'l.novak@kingston.test', name: 'L. Novak', role: 'officer', active: true },
  { id: '0196f000-0000-7000-8000-0000000000a2', email: 'manager@kingston.test', name: 'R. Okafor', role: 'manager', active: true },
  { id: '0196f000-0000-7000-8000-0000000000a5', email: 'admin@kingston.test', name: 'J. Whitfield', role: 'admin', active: true },
];

type Row = Record<string, unknown>;
type Rows = Record<string, Row>;
interface State {
  me: string | null;
  users: User[];
  schemes: { code: string; name: string }[];
  phrases: DescriptionPhrase[];
  properties: Rows;
  landlords: Rows;
  tables: Record<string, Rows>; // entity table → id → row
  reports: Rows;
  processed: string[];
  seq: number;
  audit: AuditEvent[];
  auditSeq: number;
  links: (Row & { token: string })[];
  disputes: Row[];
}

const ENTITY_TABLE: Record<string, string> = {
  visit: 'visits', visit_general: 'general', appliance: 'appliances', meter_reading: 'meters',
  room_instance: 'rooms', item_record: 'items', photo: 'photos', additional_note: 'notes', signature: 'signatures',
};

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as State;
  } catch { /* ignore */ }
  return seed();
}
function save(s: State) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* quota: keep in memory */ }
}

// ── seed ─────────────────────────────────────────────────────────────────────
let rnd = 42;
const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function monday(d = new Date()) {
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}
const at = (base: Date, dayOffset: number, h: number, min = 0) => {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, min, 0, 0);
  return d;
};

const PLANS: Record<string, string[]> = {
  'Studio flat': ['FRONT_DOOR', 'RECEPTION', 'KITCHEN', 'BATHROOM'],
  '1-bed flat': ['FRONT_DOOR', 'HALLWAY', 'RECEPTION', 'KITCHEN', 'BEDROOM_1', 'BATHROOM'],
  '2-bed flat': ['FRONT_DOOR', 'HALLWAY', 'RECEPTION', 'KITCHEN', 'BEDROOM_1', 'BEDROOM_2', 'BATHROOM'],
};

/** Seeded defect wording that fits the item it is attached to. */
function defectText(grade: string, label: string): [string, string] {
  const l = label.toLowerCase();
  const byItem: [RegExp, Record<string, [string, string]>][] = [
    [/wall|ceiling/, { F: ['Light scuffing and two small marks near the door.', 'Fair wear; no action.'], P: ['Plaster cracked and paint flaking over about 1m².', 'Make good and redecorate — landlord.'], U: ['Damp patch with black mould spreading from the corner.', 'Treat cause of damp and mould before letting.'] }],
    [/^door$|door frame|handle|lock/, { F: ['Paint chipped along the lower edge.', 'Touch up at check-out.'], P: ['Door binds on the frame and the latch does not catch.', 'Ease and adjust; replace latch.'], U: ['Lock broken — door cannot be secured.', 'Replace lock immediately — landlord.'] }],
    [/smoke|alarm/, { F: ['Unit discoloured; test button works.', 'Clean.'], P: ['Alarm chirps — low battery.', 'Replace battery.'], U: ['Smoke alarm missing from the ceiling mount.', 'Fit mains-interlinked alarm immediately.'] }],
    [/socket|switch|light|fitting/, { F: ['Faceplate scuffed.', 'No action.'], P: ['Faceplate cracked.', 'Replace faceplate.'], U: ['Exposed wiring behind the faceplate.', 'Electrician to make safe — urgent.'] }],
    [/window/, { F: ['Seals discoloured.', 'Clean.'], P: ['Handle loose; window will not lock.', 'Replace handle.'], U: ['Pane cracked across the corner.', 'Replace glazing before letting.'] }],
    [/carpet|floor/, { F: ['Light wear in the walkway.', 'Fair wear.'], P: ['Carpet stained in front of the window, approx. 1m².', 'Professional clean; replace if it persists.'], U: ['Floorboard broken — trip hazard.', 'Repair before letting.'] }],
  ];
  const hit = byItem.find(([re]) => re.test(l));
  if (hit) return hit[1][grade]!;
  const name = label.charAt(0) + label.slice(1).toLowerCase();
  return ({ F: [`Light wear to the ${l}; cosmetic only.`, 'Fair wear; no action.'], P: [`${name} damaged and needs repair.`, 'Repair or replace — landlord.'], U: [`${name} broken and unsafe to use.`, 'Make safe before letting.'] } as Record<string, [string, string]>)[grade]!;
}

function seed(): State {
  rnd = 42;
  const s: State = {
    me: null, users: SEED_USERS.map((u) => ({ ...u })), schemes: SCHEMES.map((x) => ({ code: x.code, name: x.name })),
    phrases: seedPhrases(), properties: {}, landlords: {}, reports: {}, processed: [], seq: 400, audit: [], auditSeq: 1, links: [], disputes: [],
    tables: Object.fromEntries(Object.values(ENTITY_TABLE).map((t) => [t, {}])),
  };
  const landlords = [
    { name: 'A. Pemberton', company: 'Pemberton Lettings' }, { name: 'M. Osei', company: null },
    { name: 'K. Ward', company: 'Riverside Homes Ltd' }, { name: 'T. Brennan', company: 'Brennan & Co Lettings' },
  ].map((l) => ({ id: uuidv7(), email: 'lettings@example.org', phone: null, ...l }));
  for (const l of landlords) s.landlords[l.id] = l;
  const streets = [
    ['14 Acre Road', 'KT2 6EU', '2-bed flat'], ['Flat 3, 22 Surbiton Hill Road', 'KT6 4TP', '1-bed flat'],
    ['8 Cambridge Gardens', 'KT1 3JW', '2-bed flat'], ['41 Villiers Avenue', 'KT5 8BD', '1-bed flat'],
    ['Flat 12, Eden Court', 'KT1 1BD', 'Studio flat'], ['7 Burton Road', 'KT2 5TE', '2-bed flat'],
    ['26 Elm Road', 'KT3 3HE', '1-bed flat'], ['Flat 2, 90 Ewell Road', 'KT6 6EX', 'Studio flat'],
  ] as const;
  const props = streets.map(([addressLine1, postcode, propertyType], i) => ({
    id: uuidv7(), uprn: String(128000000 + i * 1371), addressLine1, addressLine2: null, town: 'Kingston upon Thames', postcode,
    propertyType, bedrooms: propertyType === 'Studio flat' ? 0 : Number(propertyType[0]), landlordId: landlords[i % landlords.length]!.id,
  }));
  for (const p of props) s.properties[p.id] = p;

  const officers = s.users.filter((u) => u.role === 'officer');
  const wk = monday();
  const today = (new Date().getDay() + 6) % 7; // 0 = Monday
  type Spec = { prop: number; officer: number; day: number; hour: number; status: 'scheduled' | 'in_progress' | 'completed' | 'issued'; landlordSigned?: boolean; defects?: string };
  const specs: Spec[] = [
    // earlier weeks (archive + property history)
    { prop: 0, officer: 0, day: -21, hour: 10, status: 'issued', landlordSigned: true, defects: 'FF' },
    { prop: 1, officer: 1, day: -17, hour: 11, status: 'issued', landlordSigned: true, defects: 'FP' },
    { prop: 2, officer: 2, day: -12, hour: 9, status: 'issued', landlordSigned: false, defects: 'PU' },
    { prop: 3, officer: 0, day: -9, hour: 14, status: 'issued', landlordSigned: true, defects: 'F' },
    { prop: 4, officer: 1, day: -8, hour: 10, status: 'issued', landlordSigned: true, defects: '' },
    // this week
    { prop: 5, officer: 0, day: Math.max(0, today - 2), hour: 9, status: 'issued', landlordSigned: false, defects: 'FU' },
    { prop: 6, officer: 1, day: Math.max(0, today - 1), hour: 13, status: 'issued', landlordSigned: true, defects: 'FFP' },
    { prop: 7, officer: 2, day: Math.max(0, today - 1), hour: 10, status: 'issued', landlordSigned: false, defects: 'U' },
    { prop: 1, officer: 2, day: Math.max(0, today - 1), hour: 15, status: 'completed', defects: 'FP' },
    { prop: 0, officer: 0, day: today, hour: 9, status: 'in_progress', defects: 'U' },
    { prop: 2, officer: 1, day: today, hour: 11, status: 'in_progress', defects: 'F' },
    { prop: 3, officer: 0, day: today, hour: 14, status: 'scheduled' },
    { prop: 4, officer: 1, day: today, hour: 15, status: 'scheduled' },
    { prop: 2, officer: 1, day: Math.min(6, today + 1), hour: 14, status: 'scheduled' },
    { prop: 0, officer: 1, day: Math.min(6, today + 4), hour: 9, status: 'scheduled' },
    { prop: 6, officer: 1, day: Math.min(6, today + 1), hour: 10, status: 'scheduled' },
    { prop: 7, officer: 0, day: Math.min(6, today + 2), hour: 9, status: 'scheduled' },
    { prop: 5, officer: 2, day: Math.min(6, today + 2), hour: 13, status: 'scheduled' },
    { prop: 3, officer: 1, day: Math.min(6, today + 3), hour: 11, status: 'scheduled' },
  ];
  for (const sp of specs) {
    const prop = props[sp.prop]!;
    const officer = officers[sp.officer]!;
    const when = at(wk, sp.day, sp.hour, pick([0, 15, 30]));
    const id = uuidv7();
    createVisit(s, {
      id, propertyId: prop.id, schemeCode: pick(['PLS', 'PLS', 'NP', 'TF', 'PRSO'] as const), visitType: pick(['check_in', 'check_in', 'check_out', 'interim'] as const),
      scheduledAt: when.toISOString(), presentRoomCodes: PLANS[prop.propertyType]!,
    }, officer.id, sp.status);
    const visit = s.tables.visits![id]!;
    if (sp.status === 'scheduled') continue;
    const started = new Date(when.getTime() + 5 * 60_000);
    const minutes = 38 + Math.round(rand() * 55);
    visit.startedAt = started.toISOString();
    const items = Object.values(s.tables.items!).filter((i) => i.visitId === id);
    const gradeAll = sp.status !== 'in_progress';
    items.forEach((it, n) => { if (gradeAll || n < items.length * 0.45) it.condition = 'G'; });
    const codes = (sp.defects ?? '').split('').filter(Boolean);
    codes.forEach((g, n) => {
      const it = items[(n * 7 + 3) % items.length]!;
      const [comment, dil] = defectText(g, String(it.label));
      Object.assign(it, { condition: g, comment, dilapidation: dil });
    });
    for (const g of Object.values(s.tables.general!).filter((r) => r.visitId === id)) g.value = String(g.value || 'Good order');
    for (const [fieldCode, value] of [['DESCRIPTION_OF_PROPERTY', `${prop.propertyType}, purpose-built block.`], ['GENERAL_CONDITION', 'Good, recently redecorated.']]) {
      const gid = uuidv7();
      s.tables.general![gid] = { id: gid, visitId: id, fieldCode, value, updatedAt: visit.updatedAt, updatedBy: officer.id };
    }
    if (sp.status === 'completed' || sp.status === 'issued') {
      const done = new Date(started.getTime() + minutes * 60_000);
      visit.completedAt = done.toISOString();
      visit.updatedAt = done.toISOString();
    }
    if (sp.status === 'issued') {
      const issuedAt = new Date(started.getTime() + (minutes + 4) * 60_000);
      const report = {
        id: uuidv7(), visitId: id, reportNumber: `SOC-${issuedAt.getFullYear()}-${String(++s.seq).padStart(4, '0')}`,
        sha256: Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(rand() * 16)]).join(''), pdfReady: true,
        issuedAt: issuedAt.toISOString(), issuedBy: officer.id,
      };
      s.reports[report.id] = report;
      Object.assign(visit, { reportNumber: report.reportNumber, updatedAt: report.issuedAt });
      const sig = (role: string, name: string) => {
        const sid = uuidv7();
        s.tables.signatures![sid] = {
          id: sid, visitId: id, reportId: report.id, role, name, method: 'on_device', signedAt: report.issuedAt,
          contentSha256: report.sha256, reportSha256: null, hasImage: true, updatedAt: report.issuedAt, updatedBy: officer.id,
        };
      };
      sig('officer', officer.name);
      if (sp.landlordSigned) sig('landlord_agent', String(s.landlords[prop.landlordId]!.name));
      else {
        // An unsigned report gets a signing link; the first two get the demo tokens used in screenshots.
        const n = s.links.filter((l) => l.status === 'pending').length;
        const ll = s.landlords[prop.landlordId]!;
        const token = ['demo-valid', 'demo-opened'][n] ?? `tok-${uuidv7()}`;
        addLink(s, report.id, token, { recipientName: ll.name as string, recipientEmail: ll.email as string, createdBy: officer.id, createdAt: new Date(Math.max(Date.parse(report.issuedAt), Date.now() - (n + 1) * 86400_000)).toISOString(), openedAt: n === 1 ? new Date(Date.now() - 3 * 3600_000).toISOString() : null });
      }
      if (sp.landlordSigned && !s.links.some((l) => l.token === 'demo-used')) {
        addLink(s, report.id, 'demo-used', { recipientName: String(s.landlords[prop.landlordId]!.name), recipientEmail: null, createdBy: officer.id, createdAt: report.issuedAt, status: 'signed', signedAt: report.issuedAt, openedAt: report.issuedAt });
      }
    }
    {
      for (const it of items.filter((i) => i.condition === 'F' || i.condition === 'P' || i.condition === 'U')) {
        for (let k = 0; k < (it.condition === 'F' ? 1 : 2); k++) {
          const pid = uuidv7();
          s.tables.photos![pid] = {
            id: pid, visitId: id, roomInstanceId: it.roomInstanceId, itemRecordId: it.id, ref: null, capturedAt: visit.startedAt,
            lat: 51.41, lng: -0.3, stampText: `${prop.addressLine1.toUpperCase()}, ${prop.postcode}`, sha256: 'a'.repeat(64), bytes: 120_000,
            width: 1600, height: 1200, uploaded: true, deletedAt: null, updatedAt: visit.startedAt, updatedBy: officer.id,
          };
        }
      }
    }
  }
  // Expired and revoked demo links on the oldest issued report.
  const oldest = Object.values(s.reports).sort((a, b) => String(a.issuedAt).localeCompare(String(b.issuedAt)))[0];
  if (oldest) {
    addLink(s, oldest.id as string, 'demo-expired', { recipientName: 'M. Osei', recipientEmail: 'lettings@example.org', createdBy: officers[0]!.id, createdAt: new Date(Date.now() - 20 * 86400_000).toISOString(), expiresAt: new Date(Date.now() - 6 * 86400_000).toISOString(), status: 'expired' });
    addLink(s, oldest.id as string, 'demo-revoked', { recipientName: 'M. Osei', recipientEmail: null, createdBy: officers[0]!.id, createdAt: new Date(Date.now() - 19 * 86400_000).toISOString(), status: 'revoked' });
  }
  // A little audit history.
  for (const v of Object.values(s.tables.visits!).slice(0, 8)) {
    addAudit(s, 'visit', v.id as string, 'status', 'scheduled', v.status, s.users.find((u) => u.id === v.officerId)?.name ?? null, (v.startedAt as string) ?? (v.updatedAt as string));
  }
  return s;
}

function addLink(s: State, reportId: string, token: string, extra: Partial<SigningLink> & Row = {}) {
  const createdAt = (extra.createdAt as string) ?? new Date().toISOString();
  const link = {
    id: uuidv7(), reportId, role: 'landlord_agent', recipientName: null, recipientEmail: null, status: 'pending', createdAt, createdBy: s.users[0]!.id,
    expiresAt: new Date(Date.parse(createdAt) + SIGNING_LINK_DAYS * 86400_000).toISOString(), openedAt: null, signedAt: null, disputes: 0,
    ...extra, token,
  };
  s.links.push(link);
  return link;
}
const publicLink = ({ token: _t, ...l }: Row & { token: string }) => l as unknown as SigningLink;
function linkState(l: Row): string {
  if (l.status === 'pending' && Date.parse(l.expiresAt as string) < Date.now()) return 'expired';
  return l.status as string;
}
const BELOW: Record<string, true> = { F: true, P: true, U: true, NA: true };

function signingView(s: State, l: Row & { token: string }): SigningView {
  const report = s.reports[l.reportId as string]!;
  const b = bundle(s, report.visitId as string)!;
  const present = new Set(b.rooms.filter((r) => r.present).map((r) => r.id));
  const items = b.items.filter((i) => i.roomInstanceId === null || present.has(i.roomInstanceId));
  const roomLabel = (id: string | null) => b.rooms.find((r) => r.id === id)?.label ?? 'MISCELLANEOUS';
  const disputed = new Set(s.disputes.filter((d) => d.signingLinkId === l.id).map((d) => d.itemRecordId));
  return {
    status: linkState(l) as SigningView['status'], role: l.role as SigningView['role'], recipientName: (l.recipientName as string) ?? null,
    expiresAt: l.expiresAt as string, reportNumber: report.reportNumber as string,
    schemeName: s.schemes.find((x) => x.code === b.visit.schemeCode)?.name ?? b.visit.schemeCode,
    address: b.property.addressLine1, postcode: b.property.postcode, inspectedAt: b.visit.startedAt, issuedAt: report.issuedAt as string,
    officerName: userName(s, b.visit.officerId),
    stats: { items: items.length, belowGood: items.filter((i) => i.condition && BELOW[i.condition] && i.condition !== 'NA').length, photos: b.photos.filter((p) => !p.deletedAt).length },
    belowGood: items.filter((i) => i.condition && (i.condition === 'F' || i.condition === 'P' || i.condition === 'U' || (i.condition === 'NA' && i.naReason)))
      .map((i) => ({
        itemRecordId: i.id, room: roomLabel(i.roomInstanceId), item: i.label, condition: i.condition!,
        comment: i.condition === 'NA' ? i.naReason : i.comment, photoIds: b.photos.filter((p) => p.itemRecordId === i.id && !p.deletedAt).map((p) => p.id),
        disputed: disputed.has(i.id),
      })),
    signedBy: b.signatures.map((x) => ({ role: x.role, name: x.name, signedAt: x.signedAt })),
    pdfReady: !!report.pdfReady,
  };
}

/** A stamped photo placeholder (the mock keeps no image files). */
function placeholderPhoto(label: string): string {
  const hue = [190, 30, 12, 350][label.length % 4];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},18%,78%)"/><stop offset="1" stop-color="hsl(${hue},14%,58%)"/></linearGradient></defs>
<rect width="800" height="600" fill="url(#g)"/><rect x="80" y="70" width="640" height="380" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="3" stroke-dasharray="14 10"/>
<circle cx="400" cy="250" r="60" fill="rgba(255,255,255,.35)"/>
<rect y="510" width="800" height="90" fill="rgba(7,41,50,.88)"/>
<text x="24" y="545" font-family="monospace" font-size="22" fill="#f2f2f3">${label.replace(/[<&]/g, '')}</text>
<text x="24" y="578" font-family="monospace" font-size="18" fill="#cfe8ef">Evidence photo · stamped on site</text></svg>`;
}

function seedPhrases(): DescriptionPhrase[] {
  const lib: [string, string[]][] = [
    ['WALLS', ['Emulsion, magnolia', 'Emulsion, white', 'Lining paper, painted', 'Part-tiled']],
    ['CEILING', ['Smooth plaster, white', 'Artex, white', 'Coved, white']],
    ['WINDOW', ['UPVC double glazed, white', 'Timber sash, painted', 'Aluminium framed']],
    ['DOOR', ['Hardwood, painted white', 'Glazed panel', 'Flush, veneer', 'Fire door with closer']],
    ['RADIATOR', ['Single panel, white', 'Double panel, white', 'With TRV']],
    ['SMOKE_ALARM', ['Mains, interlinked', 'Battery, ceiling', 'Tested, sounded']],
    ['LIGHT_FITTING', ['Pendant with shade', 'Recessed LED downlight', 'Batten holder, no shade']],
    ['FLOORING', ['Laminate, oak effect', 'Carpet, grey', 'Vinyl, tile effect', 'Ceramic tile']],
    ['*', ['Standard, white', 'Standard, chrome', 'Not present']],
  ];
  return lib.flatMap(([itemCode, list]) => list.map((phrase, i) => ({ id: uuidv7(), itemCode, phrase, sortOrder: i })));
}

function addAudit(s: State, entity: string, entityId: string, field: string, oldValue: unknown, newValue: unknown, actorName: string | null, when = new Date().toISOString()) {
  s.audit.unshift({ id: s.auditSeq++, entity, entityId, field, oldValue, newValue, actorName, deviceId: null, at: when });
  if (s.audit.length > 400) s.audit.length = 400;
}

function createVisit(s: State, req: CreateVisitRequest, officerId: string, status = 'in_progress') {
  const now = new Date().toISOString();
  for (const c of buildVisitCreates(FORM, { ...req, formVersionId: FORM_VERSION_ID, officerId }, now)) {
    const row = { ...c.row, updatedAt: now, updatedBy: officerId } as Row;
    if (c.entity === 'visit') Object.assign(row, { status, startedAt: status === 'scheduled' ? null : now });
    // Only keep item rows for present rooms (the factory already does) — keeps localStorage small.
    s.tables[ENTITY_TABLE[c.entity]!]![c.row.id] = row;
  }
}

// ── read models ──────────────────────────────────────────────────────────────
const userName = (s: State, id: unknown) => s.users.find((u) => u.id === id)?.name ?? '';

function bundle(s: State, visitId: string): VisitBundle | null {
  const visit = s.tables.visits![visitId];
  if (!visit) return null;
  const of = (t: string) => Object.values(s.tables[t]!).filter((r) => r.visitId === visitId);
  const property = s.properties[visit.propertyId as string]!;
  const report = Object.values(s.reports).find((r) => r.visitId === visitId) ?? null;
  return {
    visit, property, landlord: property.landlordId ? s.landlords[property.landlordId as string] ?? null : null, tenancy: null,
    general: of('general'), appliances: of('appliances'), meters: of('meters'), rooms: of('rooms'), items: of('items'),
    photos: of('photos'), notes: of('notes'), report, signatures: of('signatures'),
  } as unknown as VisitBundle;
}

function summary(s: State, b: VisitBundle): VisitSummary {
  const present = new Set(b.rooms.filter((r) => r.present).map((r) => r.id));
  const items = b.items.filter((i) => i.roomInstanceId === null || present.has(i.roomInstanceId));
  return {
    id: b.visit.id, propertyId: b.visit.propertyId, schemeCode: b.visit.schemeCode, visitType: b.visit.visitType, status: b.visit.status, scheduledAt: b.visit.scheduledAt,
    reportNumber: b.visit.reportNumber, officerId: b.visit.officerId, updatedAt: b.visit.updatedAt,
    address: b.property.addressLine1, postcode: b.property.postcode, officerName: userName(s, b.visit.officerId),
    itemsTotal: items.length, itemsGraded: items.filter((i) => i.condition).length,
    defects: items.filter((i) => i.condition === 'F' || i.condition === 'P' || i.condition === 'U').length,
  };
}

const inRange = (iso: unknown, from: string, to: string) => {
  if (typeof iso !== 'string') return false;
  const d = isoDate(new Date(iso));
  return d >= from && d <= to;
};
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : Math.round((v[mid - 1]! + v[mid]!) / 2);
};

function overview(s: State, from: string, to: string): ManagerOverview {
  const visits = Object.values(s.tables.visits!);
  const reports = Object.values(s.reports);
  const minutesOf = (v: Row) => (v.startedAt && v.completedAt ? Math.round((Date.parse(v.completedAt as string) - Date.parse(v.startedAt as string)) / 60_000) : null);
  const scheduledIn = visits.filter((v) => inRange(v.scheduledAt, from, to));
  const issuedIn = reports.filter((r) => inRange(r.issuedAt, from, to));
  const landlordSigned = (visitId: unknown) => Object.values(s.tables.signatures!).some((x) => x.visitId === visitId && x.role === 'landlord_agent');
  const rangeVisitIds = new Set([...scheduledIn.map((v) => v.id), ...issuedIn.map((r) => r.visitId)]);
  const uItems = Object.values(s.tables.items!).filter((i) => i.condition === 'U' && rangeVisitIds.has(i.visitId));
  const completedIn = visits.filter((v) => inRange(v.completedAt, from, to));
  const officers = s.users.filter((u) => u.role === 'officer');
  return {
    from, to,
    kpis: {
      scheduled: scheduledIn.filter((v) => v.status === 'scheduled').length,
      inProgress: scheduledIn.filter((v) => v.status === 'in_progress').length,
      completed: scheduledIn.filter((v) => v.status === 'completed').length,
      issued: issuedIn.length,
      unacceptableOpen: uItems.length,
      unsignedByLandlord: issuedIn.filter((r) => !landlordSigned(r.visitId)).length,
      medianMinutesPerSoc: median(completedIn.map(minutesOf).filter((x): x is number => x !== null)),
    },
    byOfficer: officers.map((o) => {
      const mine = scheduledIn.filter((v) => v.officerId === o.id);
      return {
        officerId: o.id, name: o.name,
        scheduled: mine.filter((v) => v.status === 'scheduled').length,
        inProgress: mine.filter((v) => v.status === 'in_progress' || v.status === 'completed').length,
        issued: issuedIn.filter((r) => s.tables.visits![r.visitId as string]?.officerId === o.id).length,
        medianMinutes: median(completedIn.filter((v) => v.officerId === o.id).map(minutesOf).filter((x): x is number => x !== null)),
      };
    }),
    unacceptable: uItems.map((i) => {
      const v = s.tables.visits![i.visitId as string]!;
      const p = s.properties[v.propertyId as string]!;
      const room = s.tables.rooms![i.roomInstanceId as string];
      return {
        visitId: v.id as string, address: p.addressLine1 as string, postcode: p.postcode as string,
        room: (room?.label as string) ?? 'MISCELLANEOUS', item: i.label as string, comment: (i.comment as string) ?? null,
        officerName: userName(s, v.officerId), at: (v.updatedAt as string) ?? new Date().toISOString(),
      };
    }).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50),
    unsigned: issuedIn.filter((r) => !landlordSigned(r.visitId)).map((r) => {
      const v = s.tables.visits![r.visitId as string]!;
      return { reportId: r.id as string, visitId: v.id as string, reportNumber: r.reportNumber as string, address: String(s.properties[v.propertyId as string]!.addressLine1), issuedAt: r.issuedAt as string };
    }).slice(0, 50),
  };
}

function reportSummaries(s: State, q: string, from?: string | null, to?: string | null, scheme?: string | null): ReportSummary[] {
  const needle = q.trim().toLowerCase();
  return Object.values(s.reports).map((r) => {
    const v = s.tables.visits![r.visitId as string]!;
    const p = s.properties[v.propertyId as string]!;
    const b = bundle(s, v.id as string)!;
    return {
      reportId: r.id as string, reportNumber: r.reportNumber as string, visitId: v.id as string, propertyId: p.id as string,
      address: p.addressLine1 as string, postcode: p.postcode as string, schemeCode: v.schemeCode as ReportSummary['schemeCode'],
      visitType: v.visitType as ReportSummary['visitType'], officerName: userName(s, v.officerId), issuedAt: r.issuedAt as string,
      pdfReady: !!r.pdfReady, defects: summary(s, b).defects,
      landlordSigned: b.signatures.some((x) => x.role === 'landlord_agent'),
      _hay: `${p.addressLine1} ${p.postcode} ${p.uprn ?? ''} ${r.reportNumber}`.toLowerCase(),
    };
  })
    .filter((r) => (!needle || r._hay.includes(needle)) && (!from || isoDate(new Date(r.issuedAt)) >= from) && (!to || isoDate(new Date(r.issuedAt)) <= to) && (!scheme || r.schemeCode === scheme))
    .map(({ _hay: _h, ...r }) => r)
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
}

function reference(s: State): ReferenceData {
  return {
    formVersion: { id: FORM_VERSION_ID, version: 1, status: 'published', definition: FORM, publishedAt: '2026-11-15T09:00:00Z' },
    schemes: s.schemes as ReferenceData['schemes'],
    phrases: s.phrases,
    officers: s.users.filter((u) => u.active).map(({ id, name, role }) => ({ id, name, role })),
  };
}

interface PcRow { district: string; ward: string; town: string; lat: number; lng: number; addresses?: [string, string][] }
const K = 'Kingston upon Thames';
const POSTCODES: Record<string, PcRow> = {
  'KT1 1AA': { district: K, ward: 'Kingston Town', town: K, lat: 51.4085, lng: -0.3064 },
  'KT1 1BD': { district: K, ward: 'Kingston Town', town: K, lat: 51.4101, lng: -0.3046 },
  'KT1 2BZ': { district: K, ward: 'Grove', town: K, lat: 51.4019, lng: -0.3043 },
  'KT1 2EE': { district: K, ward: 'Grove', town: K, lat: 51.4002, lng: -0.3021 },
  'KT1 3JW': { district: K, ward: 'Norbiton', town: K, lat: 51.4117, lng: -0.2853 },
  'KT2 5TE': { district: K, ward: 'Canbury Gardens', town: K, lat: 51.4205, lng: -0.3002 },
  'KT2 6EU': {
    district: K, ward: 'Canbury', town: K, lat: 51.4171, lng: -0.2951,
    addresses: [['12 Acre Road', '128001234'], ['14 Acre Road', '128001236'], ['Flat A, 16 Acre Road', '128001238']],
  },
  'KT2 6PY': { district: K, ward: 'Canbury', town: K, lat: 51.4188, lng: -0.2977 },
  'KT2 7AH': { district: K, ward: 'Coombe Hill', town: K, lat: 51.4176, lng: -0.2704 },
  'KT3 3HE': { district: K, ward: 'New Malden Village', town: 'New Malden', lat: 51.4019, lng: -0.2561 },
  'KT5 8BD': { district: K, ward: 'Berrylands', town: 'Surbiton', lat: 51.3956, lng: -0.2895 },
  'KT5 9AA': { district: K, ward: 'Tolworth', town: 'Surbiton', lat: 51.3803, lng: -0.2846 },
  'KT6 4TP': { district: K, ward: "St Mark's & Seething Wells", town: 'Surbiton', lat: 51.3931, lng: -0.3021 },
  'KT6 6EX': { district: K, ward: 'Alexandra', town: 'Surbiton', lat: 51.3876, lng: -0.2953 },
  'KT6 7QZ': { district: K, ward: 'Tolworth', town: 'Surbiton', lat: 51.3779, lng: -0.2902 },
  'KT4 8AA': { district: 'Sutton', ward: 'Worcester Park North', town: 'Worcester Park', lat: 51.3794, lng: -0.2425 },
  'SW1A 1AA': { district: 'Westminster', ward: "St James's", town: 'London', lat: 51.501, lng: -0.1416 },
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const err = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) => json({ error: { code, message }, ...extra }, status);

async function handle(s: State, method: string, path: string, url: URL, init?: RequestInit): Promise<Response> {
  const body = () => (typeof init?.body === 'string' ? JSON.parse(init.body) : undefined);
  const me = s.users.find((u) => u.id === s.me && u.active) ?? null;
  const q = (k: string) => url.searchParams.get(k);
  let m: RegExpMatchArray | null;
  let pm: RegExpMatchArray | null;

  if (method === 'GET' && path === '/health') return json({ ok: true, db: true });
  if (method === 'GET' && path === '/auth/dev-users') return json({ users: s.users.filter((u) => u.active) });
  if (method === 'POST' && path === '/auth/dev-login') { s.me = body().userId; return json({ user: s.users.find((u) => u.id === s.me) }); }
  if (method === 'POST' && path === '/auth/login') {
    const u = s.users.find((x) => x.email === String(body().email).toLowerCase() && x.active);
    if (!u) return err(401, 'UNAUTHORIZED', 'Invalid credentials');
    s.me = u.id;
    return json({ user: u });
  }
  // ── public signing (token, no session) ──
  if ((m = path.match(/^\/sign\/([^/]+)(\/.*)?$/))) {
    const link = s.links.find((l) => l.token === m![1]);
    if (!link) return err(404, 'NOT_FOUND', 'This link is not valid.');
    const state = linkState(link);
    const sub = m[2] ?? '';
    if ((pm = sub.match(/^\/photos\/([^/]+)$/)) && method === 'GET') {
      const photo = s.tables.photos![pm[1]!];
      if (!photo || s.reports[link.reportId as string]?.visitId !== photo.visitId) return err(404, 'NOT_FOUND', 'No such photo');
      const item = s.tables.items![photo.itemRecordId as string];
      return new Response(placeholderPhoto(`${String(item?.label ?? 'PHOTO')} · ${String(photo.id).slice(-4)}`), { headers: { 'content-type': 'image/svg+xml' } });
    }
    if (sub === '/pdf' && method === 'GET') {
      const report = s.reports[link.reportId as string]!;
      const b = bundle(s, report.visitId as string)!;
      return new Response(renderReportHtml({ bundle: b, form: FORM, schemeName: s.schemes.find((x) => x.code === b.visit.schemeCode)?.name ?? '', officerName: userName(s, b.visit.officerId), mode: 'final', photoSrc: () => '' }), { headers: { 'content-type': 'text/html' } });
    }
    if (state === 'revoked') return err(410, 'LINK_REVOKED', 'This link has been withdrawn.');
    if (state === 'signed') return err(410, 'LINK_USED', 'This report has already been signed with this link.');
    if (state === 'expired') return err(410, 'LINK_EXPIRED', 'This link has expired.');
    if (sub === '' && method === 'GET') {
      link.openedAt ??= new Date().toISOString();
      return json(signingView(s, link));
    }
    if (sub === '' && method === 'POST') {
      const req = body() as PublicSignRequest;
      if (!req?.name || req.name.trim().length < 2 || !String(req.imageDataUrl ?? '').startsWith('data:image/png;base64,') || req.confirm !== true) return err(400, 'VALIDATION', 'Name, signature and confirmation are required.');
      const report = s.reports[link.reportId as string]!;
      const now = new Date().toISOString();
      const sid = uuidv7();
      const signature = { id: sid, visitId: report.visitId, reportId: report.id, role: link.role, name: req.name.trim(), method: 'link', signedAt: now, contentSha256: null, reportSha256: report.sha256, hasImage: true, updatedAt: now, updatedBy: null };
      s.tables.signatures![sid] = signature;
      Object.assign(link, { status: 'signed', signedAt: now });
      addAudit(s, 'signature', sid, 'signed', null, `${req.name.trim()} (${String(link.role)}) by link`, req.name.trim());
      return json({ signature });
    }
    if (sub === '/disputes' && method === 'POST') {
      const req = body() as PublicDisputeRequest;
      if (!req?.itemRecordId || String(req.comment ?? '').trim().length < 5) return err(400, 'VALIDATION', 'Please say what is wrong (at least 5 characters).');
      const item = s.tables.items![req.itemRecordId];
      const report = s.reports[link.reportId as string]!;
      if (!item || item.visitId !== report.visitId) return err(404, 'NOT_FOUND', 'No such item in this report');
      const dispute = {
        id: uuidv7(), reportId: report.id, signingLinkId: link.id, itemRecordId: item.id,
        room: String(s.tables.rooms![item.roomInstanceId as string]?.label ?? 'MISCELLANEOUS'), item: item.label, comment: req.comment.trim(),
        createdAt: new Date().toISOString(), resolvedAt: null,
      };
      s.disputes.push(dispute);
      link.disputes = Number(link.disputes ?? 0) + 1;
      return json({ dispute }, 201);
    }
    return err(404, 'NOT_FOUND', 'Unknown signing endpoint');
  }

  if (!me) return err(401, 'UNAUTHORIZED', 'Sign in');
  const isManager = me.role === 'manager' || me.role === 'admin';
  const isAdmin = me.role === 'admin';
  if (method === 'POST' && path === '/auth/logout') { s.me = null; return new Response(null, { status: 204 }); }
  if (method === 'GET' && path === '/auth/me') return json({ user: me });
  if (method === 'GET' && path === '/reference') return json(reference(s));

  // address lookup (postcodes.io-like; KT2 6EU answers like OS Places with UPRNs)
  if (method === 'GET' && path === '/address/autocomplete') {
    const needle = (q('q') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (needle.length < 2) return err(400, 'VALIDATION', 'q must be 2–8 characters');
    return json({ postcodes: Object.keys(POSTCODES).filter((pc) => pc.replace(' ', '').startsWith(needle)).slice(0, 10) });
  }
  if ((m = path.match(/^\/address\/postcode\/(.+)$/)) && method === 'GET') {
    const pc = normalisePostcode(decodeURIComponent(m[1]!));
    if (!pc) return err(400, 'INVALID_POSTCODE', 'That is not a valid UK postcode');
    const hit = POSTCODES[pc];
    if (!hit) return err(404, 'POSTCODE_NOT_FOUND', 'Postcode not found');
    const lookup: PostcodeLookup = {
      provider: hit.addresses ? 'os_places' : 'postcodes_io', postcode: pc, district: hit.district, ward: hit.ward, town: hit.town,
      lat: hit.lat, lng: hit.lng, outsideKingston: hit.district !== 'Kingston upon Thames',
      addresses: (hit.addresses ?? []).map(([line1, uprn]) => ({ uprn, addressLine1: line1, addressLine2: null, town: hit.town, postcode: pc, label: `${line1}, ${hit.town}, ${pc}` })),
    };
    return json(lookup);
  }

  // properties
  if (method === 'GET' && path === '/properties') {
    const needle = (q('q') ?? '').toLowerCase();
    const properties = Object.values(s.properties)
      .filter((p) => `${p.addressLine1} ${p.postcode} ${p.uprn ?? ''}`.toLowerCase().includes(needle))
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
  if ((m = path.match(/^\/properties\/([^/]+)\/visits$/)) && method === 'GET') {
    const visits = Object.values(s.tables.visits!).filter((v) => v.propertyId === m![1])
      .map((v) => summary(s, bundle(s, v.id as string)!)).sort((a, b) => (b.scheduledAt ?? '').localeCompare(a.scheduledAt ?? ''));
    return json({ visits });
  }

  // visits
  if (method === 'GET' && path === '/visits') {
    const [status, officerId, from, to] = [q('status'), q('officerId'), q('from'), q('to')];
    const all = Object.values(s.tables.visits!)
      .filter((v) => (isManager ? !officerId || v.officerId === officerId : v.officerId === me.id))
      .filter((v) => !status || v.status === status)
      .filter((v) => (!from && !to) || inRange(v.scheduledAt, from ?? '0000-00-00', to ?? '9999-99-99'))
      .map((v) => summary(s, bundle(s, v.id as string)!))
      .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''));
    return json({ visits: all });
  }
  if (method === 'POST' && path === '/visits') {
    const req = body() as CreateVisitRequest;
    if (s.tables.visits![req.id]) return json(bundle(s, req.id), 200); // idempotent on the device id
    if (req.officerId && req.officerId !== me.id && !isManager) return err(403, 'FORBIDDEN', 'Only managers can schedule for an officer');
    const officerId = req.officerId ?? me.id;
    createVisit(s, req, officerId, req.officerId && req.officerId !== me.id ? 'scheduled' : 'in_progress');
    addAudit(s, 'visit', req.id, 'created', null, { officer: userName(s, officerId), scheduledAt: req.scheduledAt ?? null }, me.name);
    return json(bundle(s, req.id), 201);
  }
  if ((m = path.match(/^\/visits\/([^/]+)$/)) && method === 'GET') {
    const b = bundle(s, m[1]!);
    return b ? json(b) : err(404, 'NOT_FOUND', 'No such visit');
  }
  if ((m = path.match(/^\/visits\/([^/]+)\/assign$/)) && method === 'PATCH') {
    if (!isManager) return err(403, 'FORBIDDEN', 'Managers only');
    const v = s.tables.visits![m[1]!];
    if (!v) return err(404, 'NOT_FOUND', 'No such visit');
    if (v.status === 'issued') return err(409, 'VISIT_ISSUED', 'An issued visit cannot be reassigned');
    const { officerId, scheduledAt } = body();
    const officer = s.users.find((u) => u.id === officerId && u.role === 'officer' && u.active);
    if (!officer) return err(400, 'VALIDATION', 'Choose an active officer');
    addAudit(s, 'visit', v.id as string, 'officerId', userName(s, v.officerId), officer.name, me.name);
    Object.assign(v, { officerId, scheduledAt, updatedAt: new Date().toISOString(), updatedBy: me.id });
    return json({ visit: v });
  }
  if ((m = path.match(/^\/visits\/([^/]+)\/preview$/)) && method === 'GET') {
    const b = bundle(s, m[1]!);
    if (!b) return err(404, 'NOT_FOUND', 'No such visit');
    const html = renderReportHtml({
      bundle: b, form: FORM, schemeName: s.schemes.find((x) => x.code === b.visit.schemeCode)?.name ?? b.visit.schemeCode,
      officerName: userName(s, b.visit.officerId), mode: b.report ? 'final' : 'draft', photoSrc: () => '',
    });
    return new Response(html, { headers: { 'content-type': 'text/html' } });
  }
  if ((m = path.match(/^\/visits\/([^/]+)\/issue$/)) && method === 'POST') {
    const b = bundle(s, m[1]!);
    if (!b) return err(404, 'NOT_FOUND', 'No such visit');
    if (b.report) return err(409, 'ALREADY_ISSUED', 'Already issued');
    const blockers = [
      ...issueBlockers({ ...b, visitType: b.visit.visitType, contentSha256: visitContentHash(b) }),
      ...b.photos.filter((ph) => !ph.deletedAt && !ph.uploaded).map((ph) => ({ code: 'PHOTO_NOT_UPLOADED', message: 'Photo not uploaded yet.', photoId: ph.id })),
    ];
    if (blockers.length) return err(409, 'ISSUE_BLOCKED', 'Report cannot issue yet', { blockers });
    const report = {
      id: uuidv7(), visitId: b.visit.id, reportNumber: `SOC-${new Date().getFullYear()}-${String(++s.seq).padStart(4, '0')}`,
      sha256: 'f'.repeat(64), pdfReady: true, issuedAt: new Date().toISOString(), issuedBy: me.id,
    };
    s.reports[report.id] = report;
    for (const sig of b.signatures) Object.assign(s.tables.signatures![sig.id]!, { reportId: report.id });
    Object.assign(s.tables.visits![b.visit.id]!, { status: 'issued', reportNumber: report.reportNumber, completedAt: report.issuedAt, updatedAt: report.issuedAt });
    addAudit(s, 'visit', b.visit.id, 'status', b.visit.status, 'issued', me.name);
    return json({ report }, 201);
  }

  // signing links (staff)
  if ((m = path.match(/^\/reports\/([^/]+)\/signing-links$/))) {
    const report = s.reports[m[1]!];
    if (!report) return err(404, 'NOT_FOUND', 'No such report');
    if (method === 'GET') {
      return json({ links: s.links.filter((l) => l.reportId === report.id).map((l) => ({ ...publicLink(l), status: linkState(l) })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
    }
    if (method === 'POST') {
      const req = body() as CreateSigningLinkRequest;
      const b = bundle(s, report.visitId as string)!;
      if ((req.role === 'tenant_check_in' && b.visit.visitType !== 'check_in') || (req.role === 'tenant_check_out' && b.visit.visitType !== 'check_out')) return err(400, 'ROLE_INVALID', 'That tenant role does not match this visit type.');
      if (b.signatures.some((x) => x.role === req.role)) return err(409, 'ALREADY_SIGNED', 'That role has already signed this report.');
      const token = `tok-${uuidv7().replace(/-/g, '')}`;
      const link = addLink(s, report.id as string, token, { role: req.role, recipientName: req.recipientName ?? null, recipientEmail: req.recipientEmail ?? null, createdBy: me.id });
      addAudit(s, 'signing_link', link.id, 'created', null, { role: req.role, to: req.recipientEmail ?? req.recipientName ?? null }, me.name);
      return json({ link: publicLink(link), url: `${location.origin}/sign/${token}` }, 201);
    }
  }
  if ((m = path.match(/^\/signing-links\/([^/]+)\/revoke$/)) && method === 'POST') {
    const link = s.links.find((l) => l.id === m![1]);
    if (!link) return err(404, 'NOT_FOUND', 'No such link');
    if (link.status === 'signed') return err(409, 'LINK_USED', 'A signed link cannot be revoked.');
    link.status = 'revoked';
    addAudit(s, 'signing_link', link.id as string, 'status', 'pending', 'revoked', me.name);
    return json({ link: publicLink(link) });
  }
  if ((m = path.match(/^\/reports\/([^/]+)\/disputes$/)) && method === 'GET') {
    return json({ disputes: s.disputes.filter((d) => d.reportId === m![1]).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) });
  }
  if (method === 'GET' && path === '/manage/visits.csv') {
    if (!isManager) return err(403, 'FORBIDDEN', 'Managers only');
    const [from, to] = [q('from'), q('to')];
    const rows = Object.values(s.tables.visits!).filter((v) => (!from && !to) || inRange(v.scheduledAt, from ?? '0000-00-00', to ?? '9999-99-99'))
      .map((v) => summary(s, bundle(s, v.id as string)!));
    const csv = ['Scheduled,Address,Postcode,Scheme,Type,Officer,Status,Graded,Items,Defects,Report'].concat(rows.map((r) =>
      [r.scheduledAt ?? '', r.address, r.postcode, r.schemeCode, r.visitType, r.officerName, r.status, r.itemsGraded, r.itemsTotal, r.defects, r.reportNumber ?? '']
        .map((x) => `"${String(x).replace(/"/g, '""')}"`).join(','))).join('\r\n');
    return new Response(csv, { headers: { 'content-type': 'text/csv' } });
  }

  // reports
  if (method === 'GET' && path === '/manage/reports') {
    if (!isManager) return err(403, 'FORBIDDEN', 'Managers only');
    return json({ reports: reportSummaries(s, q('q') ?? '', q('from'), q('to'), q('scheme')) });
  }
  if (method === 'GET' && path === '/manage/overview') {
    if (!isManager) return err(403, 'FORBIDDEN', 'Managers only');
    const mon = monday();
    const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
    return json(overview(s, q('from') ?? isoDate(mon), q('to') ?? isoDate(sun)));
  }
  if ((m = path.match(/^\/reports\/([^/]+)$/)) && method === 'GET') {
    const report = s.reports[m[1]!];
    if (!report) return err(404, 'NOT_FOUND', 'No such report');
    return json({ report, signatures: Object.values(s.tables.signatures!).filter((x) => x.visitId === report.visitId) });
  }
  if ((m = path.match(/^\/reports\/([^/]+)\/pdf$/)) && method === 'GET') {
    const report = s.reports[m[1]!];
    const b = report && bundle(s, report.visitId as string);
    if (!b) return err(404, 'NOT_FOUND', 'No such report');
    const html = renderReportHtml({
      bundle: b, form: FORM, schemeName: s.schemes.find((x) => x.code === b.visit.schemeCode)?.name ?? '',
      officerName: userName(s, b.visit.officerId), mode: 'final', photoSrc: () => '',
    });
    return new Response(html, { headers: { 'content-type': 'text/html' } });
  }

  // admin
  if (path.startsWith('/users') || path.startsWith('/admin')) {
    if (!isAdmin) return err(403, 'FORBIDDEN', 'Admins only');
    if (method === 'GET' && path === '/users') return json({ users: s.users });
    if (method === 'POST' && path === '/users') {
      const req = body() as CreateUserRequest;
      if (s.users.some((u) => u.email === req.email.toLowerCase())) return err(409, 'EMAIL_TAKEN', 'A user with that email already exists.');
      const user: User = { id: uuidv7(), email: req.email.toLowerCase(), name: req.name, role: req.role, active: true };
      s.users.push(user);
      addAudit(s, 'user', user.id, 'created', null, { email: user.email, role: user.role }, me.name);
      return json({ user }, 201);
    }
    if ((m = path.match(/^\/users\/([^/]+)$/)) && method === 'PATCH') {
      const u = s.users.find((x) => x.id === m![1]);
      if (!u) return err(404, 'NOT_FOUND', 'No such user');
      const req = body() as UpdateUserRequest;
      const losesAdmin = u.role === 'admin' && ((req.role && req.role !== 'admin') || req.active === false);
      if (u.id === me.id && losesAdmin) return err(409, 'SELF_LOCKOUT', 'You cannot remove your own admin access or deactivate yourself.');
      if (losesAdmin && s.users.filter((x) => x.role === 'admin' && x.active).length <= 1) return err(409, 'LAST_ADMIN', 'At least one active admin is required.');
      for (const [k, val] of Object.entries(req)) addAudit(s, 'user', u.id, k, (u as Record<string, unknown>)[k], val, me.name);
      Object.assign(u, req);
      return json({ user: u });
    }
    if ((m = path.match(/^\/users\/([^/]+)\/reset-password$/)) && method === 'POST') {
      const u = s.users.find((x) => x.id === m![1]);
      if (!u) return err(404, 'NOT_FOUND', 'No such user');
      if (String(body()?.password ?? '').length < 12) return err(400, 'VALIDATION', 'Password must be at least 12 characters.');
      addAudit(s, 'user', u.id, 'password', null, '(reset)', me.name);
      return new Response(null, { status: 204 });
    }
    if (method === 'GET' && path === '/admin/phrases') return json({ phrases: s.phrases });
    if (method === 'POST' && path === '/admin/phrases') {
      const req = body() as CreatePhraseRequest;
      const phrase: DescriptionPhrase = {
        id: uuidv7(), itemCode: req.itemCode, phrase: req.phrase,
        sortOrder: req.sortOrder ?? s.phrases.filter((p) => p.itemCode === req.itemCode).length,
      };
      s.phrases.push(phrase);
      addAudit(s, 'description_phrase', phrase.id, 'phrase', null, phrase.phrase, me.name);
      return json({ phrase }, 201);
    }
    if ((m = path.match(/^\/admin\/phrases\/([^/]+)$/)) && method === 'DELETE') {
      const p = s.phrases.find((x) => x.id === m![1]);
      s.phrases = s.phrases.filter((x) => x.id !== m![1]);
      if (p) addAudit(s, 'description_phrase', p.id, 'phrase', p.phrase, null, me.name);
      return new Response(null, { status: 204 });
    }
    if ((m = path.match(/^\/admin\/schemes\/([^/]+)$/)) && method === 'PATCH') {
      const sc = s.schemes.find((x) => x.code === m![1]);
      if (!sc) return err(404, 'NOT_FOUND', 'No such scheme');
      const name = String(body()?.name ?? '').trim();
      if (name.length < 3) return err(400, 'VALIDATION', 'Name must be at least 3 characters.');
      addAudit(s, 'scheme', FORM_VERSION_ID, `${sc.code}.name`, sc.name, name, me.name);
      sc.name = name;
      return json({ scheme: sc });
    }
    if (method === 'GET' && path === '/admin/form') {
      const summaryOut: FormSummary = {
        formVersionId: FORM_VERSION_ID, version: 1, publishedAt: '2026-11-15T09:00:00Z', source: FORM.source,
        rooms: FORM.rooms.map((r) => ({ code: r.code, label: r.label, items: r.items.length })),
        totalItems: FORM.rooms.reduce((n, r) => n + r.items.length, 0),
        conditionOptions: FORM.conditionOptions.map(({ code, label, definition }) => ({ code, label, definition })),
        itemColumns: FORM.itemColumns,
      };
      return json(summaryOut);
    }
    if (method === 'GET' && path === '/admin/system') {
      const visits = Object.values(s.tables.visits!);
      const byStatus = { scheduled: 0, in_progress: 0, completed: 0, issued: 0, cancelled: 0 } as SystemStatus['visitsByStatus'];
      for (const v of visits) byStatus[v.status as keyof typeof byStatus]++;
      const out: SystemStatus = {
        db: true, serverTime: new Date().toISOString(), uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000) + 3 * 86400 + 4 * 3600,
        counts: {
          users: s.users.length, properties: Object.keys(s.properties).length, visits: visits.length,
          reports: Object.keys(s.reports).length, photos: Object.keys(s.tables.photos!).length,
        },
        visitsByStatus: byStatus,
        jobs: { queued: 0, running: 1, failed: 1 },
        recentFailedJobs: [{ id: 87, kind: 'render_pdf', lastError: 'Chromium timed out after 30 s (retried 3×)', at: new Date(Date.now() - 26 * 3600_000).toISOString() }],
      };
      return json(out);
    }
    if (method === 'GET' && path === '/admin/audit') {
      const entity = q('entity');
      const limit = Math.min(200, Number(q('limit') ?? 50));
      return json({ events: s.audit.filter((e) => !entity || e.entity === entity).slice(0, limit) });
    }
  }

  // sync
  if (method === 'POST' && path === '/sync/push') {
    const req = body() as PushRequest;
    const results = req.mutations.map((mu: Mutation) => {
      if (s.processed.includes(mu.mutationId)) return { mutationId: mu.mutationId, status: 'duplicate' as const };
      const table = s.tables[ENTITY_TABLE[mu.entity]!]!;
      const visitId = mu.entity === 'visit' ? mu.id : (mu.data.visitId as string);
      if (s.tables.visits![visitId]?.status === 'issued') return { mutationId: mu.mutationId, status: 'rejected' as const, error: 'Visit is issued' };
      const { imageDataUrl: _img, ...data } = mu.data; // write-only on the server
      for (const [k, v] of Object.entries(data)) if (k !== 'visitId' && table[mu.id]?.[k] !== v && ['condition', 'status', 'comment'].includes(k)) addAudit(s, mu.entity, mu.id, k, table[mu.id]?.[k] ?? null, v, me.name, mu.clientUpdatedAt);
      table[mu.id] = { ...(table[mu.id] ?? {}), ...data, id: mu.id, updatedAt: mu.clientUpdatedAt, updatedBy: me.id };
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

/** Answer `/api/*` in the browser. `delayMs` simulates latency (tests pass 0). */
export function installMockApi(opts: { delayMs?: number } = {}): void {
  const state = load();
  const delay = opts.delayMs ?? 120;
  const real = globalThis.fetch?.bind(globalThis);
  setFetch(async (input, init) => {
    const url = new URL(input, location.origin);
    if (!url.pathname.startsWith('/api/')) return real(input, init);
    if (!navigator.onLine) throw new TypeError('Failed to fetch (mock offline)');
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const res = await handle(state, (init?.method ?? 'GET').toUpperCase(), url.pathname.slice(4), url, init);
    save(state);
    return res;
  });
  console.info('%c[mock api] VITE_MOCK_API=1 — requests to /api are answered in the browser', 'color:#0f5e6e');
}

/** Tests: forget persisted mock state. */
export function resetMockApi(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
