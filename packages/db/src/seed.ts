/**
 * Idempotent dev/test seed: schemes, form version 1 (published), description phrases, users,
 * demo landlords/properties/tenancies and three scheduled visits for j.patel.
 * Run: pnpm --filter @soc/db seed   (uses DATABASE_URL from ../../.env)
 */
import { pathToFileURL } from 'node:url';
import { hash } from '@node-rs/argon2';
import { and, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { SCHEMES, buildFormDefinition, type PropertyType, type Role, type SchemeCode, type VisitType } from '@soc/shared';
import type { Db } from './client.js';
import { createVisitFromForm, getPublishedFormVersion } from './queries/visits.js';
import { DEFAULT_ROOM_PLANS } from './room-plans.js';
import { descriptionPhrases, formVersions, landlords, properties, schemes, tenancies, users, visits } from './schema.js';

export const DEV_PASSWORD_DEFAULT = 'Password123!local';

export const SEED_USERS: { email: string; name: string; role: Role }[] = [
  { email: 'admin@kingston.test', name: 'Admin User', role: 'admin' },
  { email: 'manager@kingston.test', name: 'M. Manager', role: 'manager' },
  { email: 'j.patel@kingston.test', name: 'J. Patel', role: 'officer' },
  { email: 'r.owusu@kingston.test', name: 'R. Owusu', role: 'officer' },
];

/** Description library (soc-domain-model references/description-library.md), keyed by template item code. */
const LIBRARY: Record<string, string[]> = {
  WALLS: ['Emulsion, magnolia', 'Emulsion, white', 'Lining paper, painted', 'Wallpaper, neutral', 'Recently redecorated', 'Part-tiled'],
  CEILING: ['Smooth plaster, white', 'Artex, white', 'Coved, white'],
  WINDOW: ['UPVC double glazed, white', 'Timber sash, painted', 'Aluminium framed', 'Secondary glazed'],
  DOOR: ['Hardwood, painted white', 'Glazed panel', 'Flush, veneer', 'Fire door with closer'],
  RADIATOR: ['Single panel, white', 'Double panel, white', 'Column, cast iron', 'With TRV'],
  WORK_SURFACE: ['Laminate, oak effect', 'Laminate, black', 'Solid beech', 'Quartz composite'],
  BASE_UNITS_SINGLE: ['Gloss white, chrome handles', 'Shaker, grey', 'Oak effect, bar handles'],
  BASE_UNITS_DOUBLE: ['Gloss white, chrome handles', 'Shaker, grey', 'Oak effect, bar handles'],
  WALL_UNITS_SINGLE: ['Gloss white, chrome handles', 'Shaker, grey', 'Oak effect, bar handles'],
  WALL_UNITS_DOUBLE: ['Gloss white, chrome handles', 'Shaker, grey', 'Oak effect, bar handles'],
  CORNER_WALL_UNITS: ['Gloss white, chrome handles', 'Shaker, grey', 'Oak effect, bar handles'],
  // FLOORING is a general-schedule field code (decision 4), not a room item.
  FLOORING: ['Laminate, oak effect', 'Carpet, grey', 'Vinyl, tile effect', 'Ceramic tile', 'Original boards'],
  BATH: ['White acrylic, panel bath', 'White steel, shower over', 'Corner bath'],
  WATER_CLOSET: ['White, close-coupled', 'White, back to wall', 'Low-level cistern'],
  LIGHT_FITTING: ['Pendant with shade', 'Recessed LED downlight', 'Batten holder, no shade', 'Strip light'],
  SMOKE_ALARM: ['Mains, interlinked', 'Battery, ceiling', 'Heat detector (kitchen)', 'Tested, sounded'],
  LAWN: ['Turf, mown', 'Turf, overgrown'],
  OVEN: ['Zanussi ZOB35301, single electric', 'Indesit IFW6330, single'],
  HOB: ['Bosch 4-ring ceramic', 'Zanussi 4-ring gas'],
  /** Fallback chips for any item without its own list. */
  '*': ['Standard, white', 'Standard, chrome', 'Not present'],
};

/** Template abbreviation key (header of every room page) as one-tap phrases. */
const ABBREVIATIONS: [string, string[]][] = [
  ['WP white plastic', ['SINGLE_SOCKET', 'DOUBLE_SOCKET', 'SINGLE_LIGHT_SWITCH', 'DOUBLE_LIGHT_SWITCH', 'SINGLE_PULL_LIGHT_SWITCH', 'COOKER_SWITCH', 'TELEPHONE_SOCKET']],
  ['PWE painted white emulsion', ['WALLS', 'CEILING']],
  ['PCE painted cream emulsion', ['WALLS', 'CEILING']],
  ['PWG painted white gloss', ['DOOR', 'DOOR_FRAME', 'WOODWORK', 'BANISTER', 'HANDRAIL']],
  ['DG double glazed', ['WINDOW', 'PATIO_DOORS', 'BACK_DOOR']],
  ['GWG Georgian wired glass', ['WINDOW', 'DOOR', 'BACK_DOOR']],
  ['FWD flush wooden door', ['DOOR', 'BACK_DOOR']],
  ['PWD panelled wood door', ['DOOR', 'BACK_DOOR']],
  ['WF wood flooring', ['FLOORING']],
  ['CRP ceiling rose & pendant', ['LIGHT_FITTING']],
  ['LLWC low level water closet', ['WATER_CLOSET']],
  ['HLWC high level water closet', ['WATER_CLOSET']],
];

export function seedPhrases(): { itemCode: string; phrase: string; sortOrder: number }[] {
  const out = new Map<string, { itemCode: string; phrase: string; sortOrder: number }>();
  const add = (itemCode: string, phrase: string) => {
    const key = `${itemCode}\u0000${phrase}`;
    if (!out.has(key)) {
      const n = [...out.values()].filter((p) => p.itemCode === itemCode).length;
      out.set(key, { itemCode, phrase, sortOrder: (n + 1) * 10 });
    }
  };
  for (const [code, list] of Object.entries(LIBRARY)) for (const p of list) add(code, p);
  for (const [phrase, codes] of ABBREVIATIONS) for (const c of codes) add(c, phrase);
  return [...out.values()];
}

interface DemoProperty {
  landlord: { name: string; company: string | null; email: string; phone: string };
  addressLine1: string;
  postcode: string;
  propertyType: PropertyType;
  bedrooms: number;
  scheme: SchemeCode;
  tenantName: string;
  visit?: { type: VisitType; time: string };
}

/** Demo addresses from docs/reference/prototype.html. Landlord/tenant names are fictional. */
const DEMO: DemoProperty[] = [
  {
    landlord: { name: 'Pemberton Lettings', company: 'Pemberton Lettings Ltd', email: 'lettings@pemberton.example', phone: '020 7946 0001' },
    addressLine1: '14 Acre Road', postcode: 'KT2 6EU', propertyType: '3-bed house', bedrooms: 3,
    scheme: 'PLS', tenantName: 'A. Tenant', visit: { type: 'check_in', time: '09:30' },
  },
  {
    landlord: { name: 'S. Hartley', company: null, email: 's.hartley@example.com', phone: '07700 900002' },
    addressLine1: 'Flat 3, 22 Surbiton Hill Road', postcode: 'KT6 4TP', propertyType: '2-bed flat', bedrooms: 2,
    scheme: 'NP', tenantName: 'B. Tenant', visit: { type: 'check_out', time: '11:00' },
  },
  {
    landlord: { name: 'Riverside Homes', company: 'Riverside Homes Ltd', email: 'office@riverside.example', phone: '020 7946 0003' },
    addressLine1: '8 Cambridge Gardens', postcode: 'KT1 3JW', propertyType: '2-bed house', bedrooms: 2,
    scheme: 'TF', tenantName: 'C. Tenant', visit: { type: 'check_in', time: '14:00' },
  },
  {
    landlord: { name: 'K. Mensah', company: null, email: 'k.mensah@example.com', phone: '07700 900004' },
    addressLine1: '51 Villiers Avenue', postcode: 'KT5 8BD', propertyType: '3-bed house', bedrooms: 3,
    scheme: 'PRSO', tenantName: 'D. Tenant',
  },
];

export interface SeedOptions {
  password?: string;
  quiet?: boolean;
  /** Base date for the demo visits' scheduled_at (default: today). */
  today?: Date;
}

export async function seed(db: Db, opts: SeedOptions = {}): Promise<void> {
  const log = opts.quiet ? () => {} : (m: string) => console.log(`[seed] ${m}`);

  // Schemes
  await db.insert(schemes).values(SCHEMES.map((s) => ({ code: s.code, name: s.name })))
    .onConflictDoUpdate({ target: schemes.code, set: { name: sql`excluded.name` } });

  // Form version 1
  let form = await getPublishedFormVersion(db);
  if (!form) {
    const [existing] = await db.select().from(formVersions).where(eq(formVersions.version, 1));
    if (existing) throw new Error('form_versions v1 exists but nothing is published; fix manually');
    const [created] = await db.insert(formVersions)
      .values({ id: uuidv7(), version: 1, status: 'published', definition: buildFormDefinition(), publishedAt: new Date() })
      .returning();
    form = created!;
    log('form version 1 published');
  }

  // Description phrases
  const phrases = seedPhrases();
  await db.insert(descriptionPhrases).values(phrases.map((p) => ({ id: uuidv7(), ...p }))).onConflictDoNothing();

  // Users
  const password = opts.password ?? process.env.SEED_PASSWORD ?? DEV_PASSWORD_DEFAULT;
  const ids = new Map<string, string>();
  for (const u of SEED_USERS) {
    const [found] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${u.email.toLowerCase()}`);
    if (found) { ids.set(u.email, found.id); continue; }
    const id = uuidv7();
    await db.insert(users).values({ id, ...u, active: true, passwordHash: await hash(password) });
    ids.set(u.email, id);
    log(`user ${u.email} (${u.role})`);
  }
  if (password === DEV_PASSWORD_DEFAULT) log(`users use the LOCAL DEV password "${DEV_PASSWORD_DEFAULT}" (set SEED_PASSWORD to change; never use in production)`);
  const officerId = ids.get('j.patel@kingston.test')!;

  // Landlords, properties, tenancies, visits
  const base = opts.today ?? new Date();
  const day = base.toISOString().slice(0, 10);
  for (const d of DEMO) {
    let [prop] = await db.select().from(properties)
      .where(and(eq(properties.addressLine1, d.addressLine1), eq(properties.postcode, d.postcode)));
    if (!prop) {
      const landlordId = uuidv7();
      await db.insert(landlords).values({ id: landlordId, ...d.landlord });
      [prop] = await db.insert(properties).values({
        id: uuidv7(), uprn: null, addressLine1: d.addressLine1, addressLine2: null, town: 'Kingston upon Thames',
        postcode: d.postcode, propertyType: d.propertyType, bedrooms: d.bedrooms, landlordId,
      }).returning();
      log(`property ${d.addressLine1}, ${d.postcode}`);
    }
    let [tenancy] = await db.select().from(tenancies).where(eq(tenancies.propertyId, prop!.id)).limit(1);
    if (!tenancy) {
      [tenancy] = await db.insert(tenancies).values({
        id: uuidv7(), propertyId: prop!.id, schemeCode: d.scheme, tenantName: d.tenantName, startDate: day,
        endDate: null, status: d.visit?.type === 'check_out' ? 'active' : 'pending',
      }).returning();
    }
    if (!d.visit) continue;
    const [hasVisit] = await db.select({ id: visits.id }).from(visits)
      .where(and(eq(visits.propertyId, prop!.id), eq(visits.officerId, officerId))).limit(1);
    if (hasVisit) continue;
    await db.transaction(async (tx) => {
      await createVisitFromForm(tx, {
        id: uuidv7(), propertyId: prop!.id, tenancyId: tenancy!.id, schemeCode: d.scheme, visitType: d.visit!.type,
        presentRoomCodes: DEFAULT_ROOM_PLANS[d.propertyType], scheduledAt: `${day}T${d.visit!.time}:00.000Z`,
      }, officerId, form!);
    });
    log(`visit ${d.visit.type} ${d.addressLine1} ${day} ${d.visit.time} (J. Patel)`);
  }
  log('done');
}

// CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { createDb, loadRootEnv } = await import('./client.js');
  loadRootEnv();
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is not set (create .env from .env.example)'); process.exit(1); }
  const { db, close } = createDb(url, { max: 2 });
  try { await seed(db); } finally { await close(); }
}
