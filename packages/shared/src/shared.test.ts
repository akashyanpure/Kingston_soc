import { describe, expect, it } from 'vitest';
import { buildFormDefinition, withScheme } from './form.js';
import { issueBlockers, signatureBlockers } from './rules.js';
import { canonicalJson, sha256Hex } from './content.js';
import type { ItemRecord, Photo, RoomInstance, Signature, VisitGeneral } from './schemas.js';

const now = '2026-11-15T10:00:00Z';
const uid = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

describe('form definition', () => {
  const f = buildFormDefinition();
  it('mirrors the template: 15 rooms, 264 items, 13 misc rows, 21 note rows', () => {
    expect(f.rooms).toHaveLength(15);
    expect(f.rooms.reduce((n, r) => n + r.items.length, 0)).toBe(264);
    expect(f.miscellaneous.blankRows).toBe(13);
    expect(f.additionalNotes.blankRows).toBe(21);
    expect(f.rooms[0]?.label).toBe('FRONT GARDEN');
  });
  it('applies the confirmed decisions', () => {
    expect(f.conditionOptions.map((c) => c.code)).toEqual(['G', 'F', 'P', 'U', 'NA']);
    expect(f.itemColumns.at(-1)).toBe('PHOTO');
    expect(f.applianceColumns).toEqual(['MAKE', 'MODEL', 'SERIAL']);
    expect(f.general.map((g) => g.code)).toContain('KEYS_HELD');
    expect(f.signatureRoles).toHaveLength(4);
    expect(withScheme(f.boilerplate.declaration[0]!, 'Private Leasing Scheme')).toContain('guaranteed by the Private Leasing Scheme.');
  });
});

describe('issue rules', () => {
  const room = (id: number, present: boolean, widePhotoId: string | null): RoomInstance => ({
    id: uid(id), visitId: uid(1), roomCode: 'KITCHEN', label: 'KITCHEN', sortOrder: id, present, widePhotoId, updatedAt: now, updatedBy: null,
  });
  const item = (id: number, roomId: number | null, condition: ItemRecord['condition'], extra: Partial<ItemRecord> = {}): ItemRecord => ({
    id: uid(id), visitId: uid(1), roomInstanceId: roomId === null ? null : uid(roomId), itemCode: 'WALLS', label: 'WALLS', sortOrder: 0,
    qty: 1, description: null, condition, naReason: null, comment: null, dilapidation: null, updatedAt: now, updatedBy: null, ...extra,
  });
  const photo = (id: number, itemId: number | null): Photo => ({
    id: uid(id), visitId: uid(1), roomInstanceId: null, itemRecordId: itemId === null ? null : uid(itemId), ref: null, capturedAt: now,
    lat: null, lng: null, stampText: '', sha256: 'a'.repeat(64), bytes: 1, width: 1, height: 1, uploaded: true, deletedAt: null, updatedAt: now, updatedBy: null,
  });
  const general: VisitGeneral[] = ['DESCRIPTION_OF_PROPERTY', 'GENERAL_CONDITION'].map((c, i) => ({
    id: uid(900 + i), visitId: uid(1), fieldCode: c, value: 'x', updatedAt: now, updatedBy: null,
  }));

  const officerSig = (hash: string, extra: Partial<Signature> = {}): Signature => ({
    id: uid(700), visitId: uid(1), reportId: null, role: 'officer', name: 'P. Dekaate', method: 'on_device', signedAt: now,
    contentSha256: hash, reportSha256: null, hasImage: true, updatedAt: now, updatedBy: null, ...extra,
  });

  it('signature rules: officer required, stale and role checks', () => {
    expect(signatureBlockers([], 'check_in', 'h').map((b) => b.code)).toEqual(['OFFICER_SIGNATURE_MISSING']);
    expect(signatureBlockers([officerSig('old')], 'check_in', 'h').map((b) => b.code)).toEqual(['SIGNATURE_STALE']);
    const tenantOut = officerSig('h', { id: uid(701), role: 'tenant_check_out', name: 'T' });
    expect(signatureBlockers([officerSig('h'), tenantOut], 'check_in', 'h').map((b) => b.code)).toEqual(['SIGNATURE_ROLE_INVALID']);
    expect(signatureBlockers([officerSig('h')], 'check_out', 'h')).toEqual([]);
  });

  it('passes a complete visit and ignores rooms not present', () => {
    const b = issueBlockers({
      rooms: [room(10, true, uid(50)), room(11, false, null)],
      items: [item(20, 10, 'G'), item(21, 10, 'P', { comment: 'cracked' }), item(22, 11, null)],
      photos: [photo(50, null), photo(51, 21)],
      general,
      signatures: [officerSig('h')], visitType: 'check_in', contentSha256: 'h',
    });
    expect(b).toEqual([]);
  });

  it('blocks defects without comment/photo, NA without reason, ungraded items', () => {
    const b = issueBlockers({
      rooms: [room(10, true, null)],
      items: [item(20, 10, 'U'), item(21, 10, 'NA'), item(22, null, null)],
      photos: [],
      general: [],
      signatures: [], visitType: 'check_in', contentSha256: 'h',
    });
    expect(b.map((x) => x.code).sort()).toEqual(
      ['DEFECT_NO_COMMENT', 'DEFECT_NO_PHOTO', 'GENERAL_MISSING', 'GENERAL_MISSING', 'ITEM_UNGRADED', 'NA_NO_REASON', 'ROOM_NO_WIDE_PHOTO'].sort(),
    );
  });
});

describe('content hash', () => {
  it('sha256Hex matches FIPS test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
    // multi-byte UTF-8 (values from Python hashlib)
    expect(sha256Hex('£ – ü')).toBe('28b53a8bb9763413d014d33d14c59ee031a706bd229feafe068a862ba3acb0a5');
    expect(sha256Hex('😀')).toBe('f0443a342c5ef54783a111b51ba56c938e474c32324d90c3a60c9c8e3a37e2d9');
  });
  it('canonicalJson ignores key order and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: undefined, c: 3 }] })).toBe(canonicalJson({ a: [2, { c: 3 }], b: 1 }));
  });
});
