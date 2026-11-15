/**
 * UK postcode / address lookup behind one interface (contract: packages/shared/src/address.ts).
 *   postcodes_io (default) — free, no key: postcode validation, autocomplete, district/ward/coords.
 *   os_places              — Ordnance Survey Places (PSGA): every address at the postcode with UPRN.
 *   none                   — disabled; the UI falls back to manual entry.
 * Only the postcode (or partial postcode) is ever sent to a provider. Keys are never logged:
 * errors carry a provider name and HTTP status, never the request URL.
 */
import type { AddressCandidate, AddressProvider, PostcodeLookup } from '@soc/shared';

export type FetchFn = typeof fetch;

export interface AddressLookup {
  readonly provider: AddressProvider;
  /** Full postcode (already normalised, e.g. "KT2 6EU"). null = provider says it does not exist. */
  lookup(postcode: string): Promise<PostcodeLookup | null>;
  /** Up to 10 full postcodes starting with `partial`. */
  autocomplete(partial: string): Promise<string[]>;
}

/** Provider unreachable, timed out, or answered with an error (→ 502 LOOKUP_UNAVAILABLE). */
export class AddressLookupUnavailable extends Error {
  constructor(provider: string, reason: string) {
    super(`${provider} lookup unavailable: ${reason}`);
    this.name = 'AddressLookupUnavailable';
  }
}

/** Lookups are switched off (ADDRESS_PROVIDER=none). */
export class AddressLookupDisabled extends Error {}

export const KINGSTON_DISTRICT = 'Kingston upon Thames';
export const LOOKUP_TIMEOUT_MS = 4000;

async function getJson(fetchFn: FetchFn, provider: string, url: string, timeoutMs: number): Promise<{ status: number; body: unknown }> {
  let res: Response;
  try {
    res = await fetchFn(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const name = (err as { name?: string }).name;
    throw new AddressLookupUnavailable(provider, name === 'TimeoutError' || name === 'AbortError' ? 'timed out' : 'network error');
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

const SMALL_WORDS = new Set(['upon', 'on', 'the', 'and', 'of', 'in', 'under', 'by']);
/** "KINGSTON UPON THAMES" → "Kingston upon Thames"; "FLAT 3A" → "Flat 3A". */
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.replace(/^([a-z])/, (c) => c.toUpperCase())))
    .join('')
    .replace(/\b(\d+)([a-z])\b/g, (_m, d: string, l: string) => `${d}${l.toUpperCase()}`);
}

const outside = (district: string | null) => district !== KINGSTON_DISTRICT;

// ── postcodes.io ─────────────────────────────────────────────────────────────
interface PostcodesIoResult {
  postcode: string;
  admin_district: string | null;
  admin_ward: string | null;
  parish: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
}

export class PostcodesIoLookup implements AddressLookup {
  readonly provider = 'postcodes_io' as const;
  constructor(
    private readonly fetchFn: FetchFn = fetch,
    private readonly baseUrl = 'https://api.postcodes.io',
    private readonly timeoutMs = LOOKUP_TIMEOUT_MS,
  ) {}

  async lookup(postcode: string): Promise<PostcodeLookup | null> {
    const { status, body } = await getJson(this.fetchFn, this.provider, `${this.baseUrl}/postcodes/${encodeURIComponent(postcode)}`, this.timeoutMs);
    if (status === 404) return null;
    if (status !== 200) throw new AddressLookupUnavailable(this.provider, `HTTP ${status}`);
    const r = (body as { result?: PostcodesIoResult } | null)?.result;
    if (!r) return null;
    const parish = r.parish && !/unparished/i.test(r.parish) ? r.parish : null;
    return {
      provider: this.provider,
      postcode: r.postcode ?? postcode,
      district: r.admin_district ?? null,
      ward: r.admin_ward ?? null,
      town: parish ?? r.admin_district ?? r.region ?? null,
      lat: r.latitude ?? null,
      lng: r.longitude ?? null,
      addresses: [],
      outsideKingston: outside(r.admin_district ?? null),
    };
  }

  /**
   * postcodes.io matches by raw prefix (it copes with "KT26" → "KT2 6…"), but a bare outward
   * code like "KT2" also matches KT20/KT21… (Tadworth) and a trailing space is trimmed. So for an
   * exact outward code we ask for "KT2 0" … "KT2 9" in parallel and keep only real KT2 postcodes.
   */
  async autocomplete(partial: string): Promise<string[]> {
    const s = partial.toUpperCase().replace(/\s+/g, ' ').trim();
    const candidates = postcodeCandidates(s);
    const lists = await Promise.all(candidates.map((c) => this.autocompleteRaw(c)));
    const out: string[] = [];
    for (const list of lists) for (const pc of list) if (!out.includes(pc)) out.push(pc);
    // postcodes.io ignores spaces ("KT1 1" == "KT11"), so when the user typed a space the
    // district is explicit: keep only postcodes in exactly that district. "KT1 1A" then works.
    if (s.includes(' ')) {
      const district = s.split(' ')[0];
      return out.filter((pc) => pc.split(' ')[0] === district).slice(0, 10);
    }
    return (OUTWARD.test(s) ? out.filter((pc) => keepForShortInput(pc, s)) : out).slice(0, 10);
  }

  private async autocompleteRaw(partial: string): Promise<string[]> {
    const { status, body } = await getJson(this.fetchFn, this.provider, `${this.baseUrl}/postcodes/${encodeURIComponent(partial)}/autocomplete?limit=10`, this.timeoutMs);
    if (status === 404) return [];
    if (status !== 200) throw new AddressLookupUnavailable(this.provider, `HTTP ${status}`);
    const result = (body as { result?: string[] | null } | null)?.result;
    return Array.isArray(result) ? result.slice(0, 10) : [];
  }
}

const OUTWARD = /^[A-Z]{1,2}[0-9][A-Z0-9]?$/;

/**
 * Queries for a partial postcode. Short inputs shaped like an outward code ("KT2", "KT26") are
 * ambiguous: "KT2" is a district, "KT26" means "KT2 6…". Ask for the raw prefix AND "<input> 0…9".
 */
export function postcodeCandidates(input: string): string[] {
  const s = input.toUpperCase().replace(/\s+/g, ' ').trim();
  if (OUTWARD.test(s)) return [s, ...Array.from({ length: 10 }, (_, d) => `${s} ${d}`)];
  return [s];
}

/** Keep "KT2 6EU" for "KT2" and for "KT26", but not "KT20 5AA" for "KT2". */
function keepForShortInput(pc: string, s: string): boolean {
  const outward = pc.split(' ')[0] ?? '';
  if (outward === s) return true; // exactly that district
  const compact = pc.replace(' ', '');
  return compact.startsWith(s) && outward.length < s.length; // input runs into the inward code
}

// ── OS Places (AddressBase, PSGA) ────────────────────────────────────────────
interface OsDpa {
  UPRN?: string;
  ADDRESS?: string;
  ORGANISATION_NAME?: string;
  SUB_BUILDING_NAME?: string;
  BUILDING_NAME?: string;
  BUILDING_NUMBER?: string;
  DEPENDENT_THOROUGHFARE_NAME?: string;
  THOROUGHFARE_NAME?: string;
  DEPENDENT_LOCALITY?: string;
  POST_TOWN?: string;
  POSTCODE?: string;
  LOCAL_CUSTODIAN_CODE_DESCRIPTION?: string;
  LAT?: number;
  LNG?: number;
}

/** Map one OS Places DPA record to the shared AddressCandidate. */
export function mapOsDpa(d: OsDpa, fallbackPostcode: string): AddressCandidate {
  const tc = (s?: string) => (s && s.trim() ? titleCase(s.trim()) : null);
  const premises = [tc(d.SUB_BUILDING_NAME), tc(d.BUILDING_NAME)].filter(Boolean).join(', ');
  const street = [d.BUILDING_NUMBER?.trim(), tc(d.DEPENDENT_THOROUGHFARE_NAME), tc(d.THOROUGHFARE_NAME)].filter(Boolean).join(' ');
  const locality = tc(d.DEPENDENT_LOCALITY);
  let line1: string;
  let rest: (string | null)[];
  if (premises) {
    line1 = premises;
    rest = [street || null, locality];
  } else if (street) {
    line1 = street;
    rest = [locality];
  } else {
    line1 = tc(d.ORGANISATION_NAME) ?? tc(d.ADDRESS?.split(',')[0]) ?? '';
    rest = [locality];
  }
  const line2 = rest.filter(Boolean).join(', ');
  return {
    uprn: d.UPRN ? String(d.UPRN) : null,
    addressLine1: line1,
    addressLine2: line2 || null,
    town: tc(d.POST_TOWN) ?? '',
    postcode: d.POSTCODE ?? fallbackPostcode,
    label: d.ADDRESS ?? [line1, line2, tc(d.POST_TOWN), d.POSTCODE].filter(Boolean).join(', '),
  };
}

export class OsPlacesLookup implements AddressLookup {
  readonly provider = 'os_places' as const;
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchFn = fetch,
    /** Autocomplete is not offered by OS Places; postcodes.io serves it. */
    private readonly autocompleter: AddressLookup = new PostcodesIoLookup(fetchFn),
    private readonly baseUrl = 'https://api.os.uk/search/places/v1',
    private readonly timeoutMs = LOOKUP_TIMEOUT_MS,
  ) {
    if (!apiKey) throw new Error('OS_PLACES_API_KEY is required for ADDRESS_PROVIDER=os_places');
  }

  async lookup(postcode: string): Promise<PostcodeLookup | null> {
    const qs = new URLSearchParams({ postcode, key: this.apiKey, output_srs: 'WGS84', maxresults: '100' });
    const { status, body } = await getJson(this.fetchFn, this.provider, `${this.baseUrl}/postcode?${qs}`, this.timeoutMs);
    if (status === 404 || status === 400) return null;
    if (status !== 200) throw new AddressLookupUnavailable(this.provider, `HTTP ${status}`);
    const results = ((body as { results?: { DPA?: OsDpa }[] } | null)?.results ?? []).map((r) => r.DPA).filter((d): d is OsDpa => !!d);
    if (!results.length) return null;
    const first = results[0]!;
    const district = first.LOCAL_CUSTODIAN_CODE_DESCRIPTION ? titleCase(first.LOCAL_CUSTODIAN_CODE_DESCRIPTION) : null;
    const addresses = results.map((d) => mapOsDpa(d, postcode));
    return {
      provider: this.provider,
      postcode: first.POSTCODE ?? postcode,
      district,
      ward: null,
      town: addresses[0]?.town || null,
      lat: typeof first.LAT === 'number' ? first.LAT : null,
      lng: typeof first.LNG === 'number' ? first.LNG : null,
      addresses,
      outsideKingston: outside(district),
    };
  }

  autocomplete(partial: string): Promise<string[]> {
    return this.autocompleter.autocomplete(partial);
  }
}

// ── Disabled ─────────────────────────────────────────────────────────────────
export class DisabledLookup implements AddressLookup {
  readonly provider = 'none' as const;
  async lookup(): Promise<PostcodeLookup | null> {
    throw new AddressLookupDisabled('Address lookup is turned off (ADDRESS_PROVIDER=none).');
  }
  async autocomplete(): Promise<string[]> {
    return [];
  }
}

// ── Cache (LRU + TTL); caches answers incl. "not found", never errors ───────
export class CachedLookup implements AddressLookup {
  private readonly cache = new Map<string, { at: number; value: unknown }>();
  constructor(
    private readonly inner: AddressLookup,
    private readonly maxEntries = 500,
    private readonly ttlMs = 24 * 60 * 60 * 1000,
    private readonly now = () => Date.now(),
  ) {}

  get provider() {
    return this.inner.provider;
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) {
      this.cache.delete(key); // refresh LRU position
      this.cache.set(key, hit);
      return hit.value as T;
    }
    const value = await load();
    this.cache.set(key, { at: this.now(), value });
    while (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value!);
    return value;
  }

  lookup(postcode: string) {
    return this.cached(`pc:${postcode}`, () => this.inner.lookup(postcode));
  }
  autocomplete(partial: string) {
    return this.cached(`ac:${partial.toUpperCase()}`, () => this.inner.autocomplete(partial));
  }
}

export function createAddressLookup(cfg: { addressProvider: AddressProvider; osPlacesApiKey: string | null }, fetchFn: FetchFn = fetch): AddressLookup {
  switch (cfg.addressProvider) {
    case 'os_places':
      return new CachedLookup(new OsPlacesLookup(cfg.osPlacesApiKey ?? '', fetchFn));
    case 'none':
      return new DisabledLookup();
    default:
      return new CachedLookup(new PostcodesIoLookup(fetchFn));
  }
}
