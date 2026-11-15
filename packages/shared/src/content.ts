/**
 * Content fingerprint of a visit — what a signer is agreeing to.
 *
 * Decision (user, 2026-11-15): e-signatures only, captured on the device at the review step
 * BEFORE issue, and printed in the issued PDF. Each signature stores the contentSha256 of the
 * draft it was given to sign; the server refuses to issue if the content has changed since
 * (blocker SIGNATURE_STALE). The same hash is printed on the declaration page ("wording
 * acceptable", user 2026-11-15) and stored in reports.snapshot.contentSha256.
 *
 * Pure TypeScript (no Node / DOM APIs) so the device and the server compute identical hashes.
 */
import type { VisitBundle } from './schemas.js';

/** Deterministic JSON: object keys sorted, undefined dropped, arrays kept in order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

// ── SHA-256 (FIPS 180-4), synchronous, pure JS ────────────────────────────────
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** UTF-8 encode without TextEncoder (keeps this module free of DOM/Node typings). */
export function utf8Bytes(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

export function sha256Hex(input: string | Uint8Array): string {
  const msg = typeof input === 'string' ? utf8Bytes(input) : input;
  const bitLen = msg.length * 8;
  const padded = new Uint8Array(((msg.length + 9 + 63) >> 6) << 6);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(padded.length - 4, bitLen >>> 0);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const w15 = W[i - 15]!, w2 = W[i - 2]!;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      W[i] = (W[i - 16]! + s0 + W[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = [H[0]!, H[1]!, H[2]!, H[3]!, H[4]!, H[5]!, H[6]!, H[7]!];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i]! + W[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0]! + a) >>> 0; H[1] = (H[1]! + b) >>> 0; H[2] = (H[2]! + c) >>> 0; H[3] = (H[3]! + d) >>> 0;
    H[4] = (H[4]! + e) >>> 0; H[5] = (H[5]! + f) >>> 0; H[6] = (H[6]! + g) >>> 0; H[7] = (H[7]! + h) >>> 0;
  }
  return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('');
}

// ── What counts as "the content" ─────────────────────────────────────────────
const strip = <T extends Record<string, unknown>>(row: T, drop: readonly string[]) => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!drop.includes(k)) out[k] = v;
  return out;
};
/** Bookkeeping fields that change without changing what the signer agreed to. */
const META = ['updatedAt', 'updatedBy'] as const;
const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/**
 * The signable content of a visit: everything that is printed in the report body.
 * Excludes signatures, the report row, sync bookkeeping (updatedAt/updatedBy, photo.uploaded),
 * server-assigned values (visit.status, reportNumber, photo.ref, timestamps of the visit
 * lifecycle) and soft-deleted rows. Rooms not present and their items are excluded too,
 * because they are not printed.
 */
export function visitContent(b: Pick<VisitBundle, 'visit' | 'property' | 'landlord' | 'tenancy' | 'general' | 'appliances' | 'meters' | 'rooms' | 'items' | 'photos' | 'notes'>) {
  const present = new Set(b.rooms.filter((r) => r.present).map((r) => r.id));
  const live = <T extends { deletedAt?: string | null }>(rows: T[]) => rows.filter((r) => !r.deletedAt);
  return {
    visit: { id: b.visit.id, propertyId: b.visit.propertyId, tenancyId: b.visit.tenancyId, schemeCode: b.visit.schemeCode, visitType: b.visit.visitType, officerId: b.visit.officerId },
    property: b.property,
    landlord: b.landlord,
    tenancy: b.tenancy,
    general: byId(b.general).map((r) => strip(r, META)),
    appliances: byId(b.appliances).map((r) => strip(r, META)),
    meters: byId(b.meters).map((r) => strip(r, META)),
    rooms: byId(b.rooms.filter((r) => r.present)).map((r) => strip(r, META)),
    items: byId(live(b.items as (typeof b.items[number] & { deletedAt?: string | null })[]).filter((i) => i.roomInstanceId === null || present.has(i.roomInstanceId))).map((r) => strip(r, META)),
    photos: byId(live(b.photos)).map((r) => strip(r, [...META, 'uploaded', 'ref'])),
    notes: byId(b.notes).map((r) => strip(r, META)),
  };
}

export function visitContentHash(b: Parameters<typeof visitContent>[0]): string {
  return sha256Hex(canonicalJson(visitContent(b)));
}
