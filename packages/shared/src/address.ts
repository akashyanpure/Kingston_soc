/**
 * UK postcode / address lookup (decision 2026-11-15).
 *
 * Provider is server-side configuration so the device never talks to third parties and
 * keys stay on the server:
 *   ADDRESS_PROVIDER=postcodes_io (default, MVP) — free, no key. Validates and autocompletes
 *       postcodes; returns borough (admin district), ward, coordinates. NO house-level addresses.
 *   ADDRESS_PROVIDER=os_places + OS_PLACES_API_KEY — Ordnance Survey Places (AddressBase),
 *       free to the council under the Public Sector Geospatial Agreement (PSGA). Returns every
 *       address at the postcode WITH its UPRN.
 *   ADDRESS_PROVIDER=none — lookups disabled (manual entry only).
 * Only the postcode/partial postcode is sent to the provider — never any personal data.
 * Offline, the device skips lookup and the officer types the address as before.
 *
 * | GET | /api/address/autocomplete?q= | any signed-in | q = 2–8 chars of a postcode | { postcodes: string[] } (max 10) |
 * | GET | /api/address/postcode/:postcode | any signed-in | — | PostcodeLookup (404 POSTCODE_NOT_FOUND) |
 */
import { z } from 'zod';

export const ADDRESS_PROVIDERS = ['postcodes_io', 'os_places', 'none'] as const;
export type AddressProvider = (typeof ADDRESS_PROVIDERS)[number];

/** Loose UK postcode check (full validation is the provider's job). */
export const UK_POSTCODE_RE = /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/i;

/** "kt26eu" / "KT2  6EU" → "KT2 6EU". Returns null if it can't be a full UK postcode. */
export function normalisePostcode(input: string): string | null {
  const s = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length < 5 || s.length > 7) return null;
  const pc = `${s.slice(0, -3)} ${s.slice(-3)}`;
  return UK_POSTCODE_RE.test(pc) ? pc : null;
}

export const AddressCandidate = z.object({
  uprn: z.string().nullable(),
  addressLine1: z.string(),
  addressLine2: z.string().nullable(),
  town: z.string(),
  postcode: z.string(),
  /** Provider's single-line form, for display in a pick-list. */
  label: z.string(),
});
export type AddressCandidate = z.infer<typeof AddressCandidate>;

export const PostcodeLookup = z.object({
  provider: z.enum(ADDRESS_PROVIDERS),
  postcode: z.string(), // normalised, e.g. "KT2 6EU"
  district: z.string().nullable(), // e.g. "Kingston upon Thames"
  ward: z.string().nullable(),
  town: z.string().nullable(), // best available town/locality
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  /** House-level addresses (OS Places). Empty with postcodes.io. */
  addresses: z.array(AddressCandidate),
  /** True when the postcode is outside the Royal Borough of Kingston upon Thames — show a gentle warning, don't block. */
  outsideKingston: z.boolean(),
});
export type PostcodeLookup = z.infer<typeof PostcodeLookup>;

export const PostcodeAutocomplete = z.object({ postcodes: z.array(z.string()).max(10) });
export type PostcodeAutocomplete = z.infer<typeof PostcodeAutocomplete>;
