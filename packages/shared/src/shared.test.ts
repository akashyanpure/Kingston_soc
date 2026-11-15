import { describe, expect, it } from 'vitest';
import { buildFormDefinition, withScheme } from './form.js';
import { issueBlockers } from './rules.js';
import type { ItemRecord, Photo, RoomInstance, VisitGeneral } from './schemas.js';

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

  it('passes a complete visit and ignores rooms not present', () => {
    const b = issueBlockers({
      rooms: [room(10, true, uid(50)), room(11, false, null)],
      items: [item(20, 10, 'G'), item(21, 10, 'P', { comment: 'cracked' }), item(22, 11, null)],
      photos: [photo(50, null), photo(51, 21)],
      general,
    });
    expect(b).toEqual([]);
  });

  it('blocks defects without comment/photo, NA without reason, ungraded items', () => {
    const b = issueBlockers({
      rooms: [room(10, true, null)],
      items: [item(20, 10, 'U'), item(21, 10, 'NA'), item(22, null, null)],
      photos: [],
      general: [],
    });
    expect(b.map((x) => x.code).sort()).toEqual(
      ['DEFECT_NO_COMMENT', 'DEFECT_NO_PHOTO', 'GENERAL_MISSING', 'GENERAL_MISSING', 'ITEM_UNGRADED', 'NA_NO_REASON', 'ROOM_NO_WIDE_PHOTO'].sort(),
    );
  });
});
