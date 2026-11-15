import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CachedLookup, DisabledLookup, OsPlacesLookup, PostcodesIoLookup, createAddressLookup, mapOsDpa, titleCase,
} from '../src/adapters/address/index.js';
import type { AddressLookup, FetchFn } from '../src/adapters/address/index.js';
import { loadConfig } from '../src/config.js';
import { login, setup } from './helpers.js';
import type { TestApp } from './helpers.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Fake fetch: routes by URL substring, records every call. */
function fakeFetch(routes: Record<string, () => Response | Promise<Response>>) {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    for (const [k, h] of Object.entries(routes)) if (url.includes(k)) return h();
    if (init?.signal) {
      // unmatched route: hang until aborted (simulates a slow provider)
      return new Promise<Response>((_res, rej) => init.signal!.addEventListener('abort', () => rej(init.signal!.reason)));
    }
    return json(404, { status: 404, error: 'Not found' });
  }) as FetchFn;
  return { fn, calls };
}

const PIO_KT2 = {
  status: 200,
  result: {
    postcode: 'KT2 6EU', admin_district: 'Kingston upon Thames', admin_ward: 'Canbury Gardens',
    parish: 'Kingston upon Thames, unparished area', region: 'London', latitude: 51.4103, longitude: -0.3003,
  },
};
const PIO_SW1 = { status: 200, result: { postcode: 'SW1A 1AA', admin_district: 'Westminster', admin_ward: "St James's", parish: null, region: 'London', latitude: 51.501, longitude: -0.1416 } };

const OS_KT2 = {
  header: { totalresults: 2 },
  results: [
    { DPA: {
      UPRN: '128011234', ADDRESS: '14, ACRE ROAD, KINGSTON UPON THAMES, KT2 6EU', BUILDING_NUMBER: '14', THOROUGHFARE_NAME: 'ACRE ROAD',
      POST_TOWN: 'KINGSTON UPON THAMES', POSTCODE: 'KT2 6EU', LOCAL_CUSTODIAN_CODE_DESCRIPTION: 'KINGSTON UPON THAMES', LAT: 51.4103, LNG: -0.3003,
    } },
    { DPA: {
      UPRN: '128011235', ADDRESS: 'FLAT 3, RIVERSIDE HOUSE, 16 ACRE ROAD, KINGSTON UPON THAMES, KT2 6EU', SUB_BUILDING_NAME: 'FLAT 3',
      BUILDING_NAME: 'RIVERSIDE HOUSE', BUILDING_NUMBER: '16', THOROUGHFARE_NAME: 'ACRE ROAD', POST_TOWN: 'KINGSTON UPON THAMES', POSTCODE: 'KT2 6EU',
      LOCAL_CUSTODIAN_CODE_DESCRIPTION: 'KINGSTON UPON THAMES', LAT: 51.4104, LNG: -0.3004,
    } },
  ],
};

describe('address adapters', () => {
  it('postcodes.io: maps district, ward, town and coordinates', async () => {
    const f = fakeFetch({ '/postcodes/KT2%206EU': () => json(200, PIO_KT2), '/postcodes/SW1A%201AA': () => json(200, PIO_SW1) });
    const pio = new PostcodesIoLookup(f.fn);
    expect(await pio.lookup('KT2 6EU')).toEqual({
      provider: 'postcodes_io', postcode: 'KT2 6EU', district: 'Kingston upon Thames', ward: 'Canbury Gardens', town: 'Kingston upon Thames',
      lat: 51.4103, lng: -0.3003, addresses: [], outsideKingston: false,
    });
    expect((await pio.lookup('SW1A 1AA'))?.outsideKingston).toBe(true);
    expect(f.calls[0]).toBe('https://api.postcodes.io/postcodes/KT2%206EU');
  });

  it('OS Places: maps every address with UPRN, title-cased lines and town; sends only the postcode + key', async () => {
    const f = fakeFetch({ '/search/places/v1/postcode': () => json(200, OS_KT2), '/autocomplete': () => json(200, { result: ['KT2 6EU', 'KT2 6EX'] }) });
    const os = new OsPlacesLookup('secret-key', f.fn);
    const r = (await os.lookup('KT2 6EU'))!;
    expect(r).toMatchObject({ provider: 'os_places', postcode: 'KT2 6EU', district: 'Kingston upon Thames', town: 'Kingston upon Thames', outsideKingston: false, lat: 51.4103 });
    expect(r.addresses).toEqual([
      { uprn: '128011234', addressLine1: '14 Acre Road', addressLine2: null, town: 'Kingston upon Thames', postcode: 'KT2 6EU', label: '14, ACRE ROAD, KINGSTON UPON THAMES, KT2 6EU' },
      { uprn: '128011235', addressLine1: 'Flat 3, Riverside House', addressLine2: '16 Acre Road', town: 'Kingston upon Thames', postcode: 'KT2 6EU', label: 'FLAT 3, RIVERSIDE HOUSE, 16 ACRE ROAD, KINGSTON UPON THAMES, KT2 6EU' },
    ]);
    const url = new URL(f.calls[0]!);
    expect(url.origin + url.pathname).toBe('https://api.os.uk/search/places/v1/postcode');
    expect([...url.searchParams.keys()].sort()).toEqual(['key', 'maxresults', 'output_srs', 'postcode']);
    expect(url.searchParams.get('postcode')).toBe('KT2 6EU');
    // Autocomplete is served by postcodes.io.
    expect(await os.autocomplete('KT2 6')).toEqual(['KT2 6EU', 'KT2 6EX']);
    expect(f.calls[1]).toContain('api.postcodes.io/postcodes/KT2%206/autocomplete');
  });

  it('OS Places: empty result is not found; requires a key', async () => {
    const f = fakeFetch({ '/search/places': () => json(200, { header: { totalresults: 0 } }) });
    expect(await new OsPlacesLookup('k', f.fn).lookup('KT9 9ZZ')).toBeNull();
    expect(() => new OsPlacesLookup('', f.fn)).toThrow(/OS_PLACES_API_KEY/);
  });

  it('title-cases OS address parts', () => {
    expect(titleCase('KINGSTON UPON THAMES')).toBe('Kingston upon Thames');
    expect(titleCase('FLAT 3A')).toBe('Flat 3A');
    expect(mapOsDpa({ ORGANISATION_NAME: 'GUILDHALL', POST_TOWN: 'KINGSTON UPON THAMES', POSTCODE: 'KT1 1EU' }, 'KT1 1EU').addressLine1).toBe('Guildhall');
  });

  it('caches answers (incl. not found) so a repeat lookup does not fetch again', async () => {
    const f = fakeFetch({ '/postcodes/KT2%206EU': () => json(200, PIO_KT2), '/postcodes/KT9%209ZZ': () => json(404, { status: 404 }) });
    const cached = new CachedLookup(new PostcodesIoLookup(f.fn), 2);
    await cached.lookup('KT2 6EU');
    await cached.lookup('KT2 6EU');
    expect(await cached.lookup('KT9 9ZZ')).toBeNull();
    expect(await cached.lookup('KT9 9ZZ')).toBeNull();
    expect(f.calls).toHaveLength(2);
  });

  it('config: os_places requires OS_PLACES_API_KEY; default provider is postcodes_io', () => {
    const base = { DATABASE_URL: 'postgres://x', SESSION_SECRET: 'x'.repeat(20) };
    expect(loadConfig(base).addressProvider).toBe('postcodes_io');
    expect(() => loadConfig({ ...base, ADDRESS_PROVIDER: 'os_places' })).toThrow(/OS_PLACES_API_KEY/);
    expect(loadConfig({ ...base, ADDRESS_PROVIDER: 'os_places', OS_PLACES_API_KEY: 'k' }).osPlacesApiKey).toBe('k');
    expect(createAddressLookup({ addressProvider: 'none', osPlacesApiKey: null })).toBeInstanceOf(DisabledLookup);
  });
});

describe('address routes', () => {
  let t: TestApp;
  let cookie: string;
  let f: ReturnType<typeof fakeFetch>;
  beforeAll(async () => {
    f = fakeFetch({
      '/postcodes/KT2%206EU': () => json(200, PIO_KT2),
      '/postcodes/KT9%209ZZ': () => json(404, { status: 404, error: 'Postcode not found' }),
      '/postcodes/KT2%206/autocomplete': () => json(200, { result: ['KT2 6EU', 'KT2 6EX'] }),
      '/postcodes/KT5%205BX': () => json(500, {}),
    });
    // Short timeout so the "slow provider" case finishes quickly.
    const address: AddressLookup = new CachedLookup(new PostcodesIoLookup(f.fn, 'https://api.postcodes.io', 150));
    t = await setup({}, undefined, { address });
    cookie = await login(t, 'officer');
  });
  afterAll(async () => {
    await t?.close();
  });
  const get = (url: string, c: string | null = cookie) => t.app.inject({ method: 'GET', url, headers: c ? { cookie: c } : {} });

  it('requires a session', async () => {
    expect((await get('/api/address/postcode/KT26EU', null)).statusCode).toBe(401);
    expect((await get('/api/address/autocomplete?q=KT2', null)).statusCode).toBe(401);
  });

  it('normalises and looks up a postcode, cached on repeat', async () => {
    const before = f.calls.length;
    const res = await get('/api/address/postcode/kt26eu');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ provider: 'postcodes_io', postcode: 'KT2 6EU', district: 'Kingston upon Thames', ward: 'Canbury Gardens', outsideKingston: false });
    expect((await get('/api/address/postcode/KT2%206EU')).statusCode).toBe(200);
    expect(f.calls.length - before).toBe(1);
  });

  it('400 INVALID_POSTCODE, 404 POSTCODE_NOT_FOUND, 502 LOOKUP_UNAVAILABLE on error or timeout', async () => {
    const invalid = await get('/api/address/postcode/NOTAPC');
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('INVALID_POSTCODE');
    const missing = await get('/api/address/postcode/KT99ZZ');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('POSTCODE_NOT_FOUND');
    expect((await get('/api/address/postcode/KT55BX')).json().error.code).toBe('LOOKUP_UNAVAILABLE'); // provider 500
    const slow = await get('/api/address/postcode/KT5%205AA'); // unmatched → hangs → aborted by timeout
    expect(slow.statusCode).toBe(502);
    expect(slow.json().error.code).toBe('LOOKUP_UNAVAILABLE');
  });

  it('autocompletes partial postcodes and validates q', async () => {
    const res = await get('/api/address/autocomplete?q=KT2%206');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ postcodes: ['KT2 6EU', 'KT2 6EX'] });
    expect((await get('/api/address/autocomplete?q=K')).statusCode).toBe(400);
    expect((await get('/api/address/autocomplete?q=KT2%206EUXXX')).statusCode).toBe(400);
  });

  it('disabled provider → 404 LOOKUP_DISABLED and empty autocomplete', async () => {
    const off = await setup({}, undefined, { address: new DisabledLookup() });
    try {
      const c = await login(off, 'officer');
      const r = await off.app.inject({ method: 'GET', url: '/api/address/postcode/KT26EU', headers: { cookie: c } });
      expect(r.statusCode).toBe(404);
      expect(r.json().error.code).toBe('LOOKUP_DISABLED');
      const a = await off.app.inject({ method: 'GET', url: '/api/address/autocomplete?q=KT2', headers: { cookie: c } });
      expect(a.json()).toEqual({ postcodes: [] });
    } finally {
      await off.close();
    }
  });
});
