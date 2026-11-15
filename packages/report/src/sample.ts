/**
 * Deterministic sample visit (based on the reference example SOC-2026-0417) for tests,
 * previews and UI development. Not real data.
 */
import { buildFormDefinition } from '@soc/shared';
import type { FormDefinition, ItemRecord, Photo, RoomInstance, VisitBundle } from '@soc/shared';

const uid = (n: number) => `0190a000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const T = '2026-09-15T09:40:00+01:00';

export function sampleBundle(form: FormDefinition = buildFormDefinition()): VisitBundle {
  const visitId = uid(1);
  const meta = { updatedAt: T, updatedBy: uid(900) };
  let n = 100;
  const presentCodes = new Set(['FRONT_DOOR', 'HALLWAY', 'RECEPTION', 'KITCHEN', 'BATHROOM']);
  const rooms: RoomInstance[] = form.rooms.map((r, i) => ({
    id: uid(10 + i), visitId, roomCode: r.code, label: r.label, sortOrder: i, present: presentCodes.has(r.code), widePhotoId: null, ...meta,
  }));
  const items: ItemRecord[] = [];
  for (const room of rooms.filter((r) => r.present)) {
    const def = form.rooms.find((r) => r.code === room.roomCode)!;
    def.items.forEach((it, i) => {
      items.push({
        id: uid(n++), visitId, roomInstanceId: room.id, itemCode: it.code, label: it.label, sortOrder: i,
        qty: 1, description: 'PWE', condition: 'G', naReason: null, comment: null, dilapidation: null, ...meta,
      });
    });
  }
  const kitchen = rooms.find((r) => r.roomCode === 'KITCHEN')!;
  const kItems = items.filter((i) => i.roomInstanceId === kitchen.id);
  const walls = kItems[0]!;
  Object.assign(walls, { condition: 'F', comment: 'Grease staining above the hob, approx. 0.5m patch.', description: 'Emulsion, magnolia' });
  const second = kItems[1]!;
  Object.assign(second, { condition: 'NA', naReason: 'Not accessible — boxed in.' });
  items.push({
    id: uid(n++), visitId, roomInstanceId: null, itemCode: null, label: 'GARDEN TABLE', sortOrder: 0, qty: 1,
    description: 'Teak, 4-seat', condition: 'P', naReason: null, comment: 'Split top board.', dilapidation: 'Replace top board', ...meta,
  });
  const misc = items.at(-1)!;

  const photo = (id: number, minutes: number, extra: Partial<Photo>): Photo => ({
    id: uid(id), visitId, roomInstanceId: null, itemRecordId: null, ref: null,
    capturedAt: `2026-09-15T09:${String(minutes).padStart(2, '0')}:00+01:00`, lat: 51.4103, lng: -0.3003,
    stampText: `14 ACRE ROAD, KT2 6EU\n15/09/2026 09:${String(minutes).padStart(2, '0')} · 51.4103°N 0.3003°W`,
    sha256: 'a'.repeat(64), bytes: 1000, width: 1600, height: 1200, uploaded: true, deletedAt: null, ...meta, ...extra,
  });
  const photos: Photo[] = [];
  for (const [i, room] of rooms.filter((r) => r.present).entries()) {
    const p = photo(500 + i, 34 + i, { roomInstanceId: room.id });
    room.widePhotoId = p.id;
    photos.push(p);
  }
  photos.push(photo(600, 51, { roomInstanceId: kitchen.id, itemRecordId: walls.id }));
  photos.push(photo(601, 55, { itemRecordId: misc.id }));

  return {
    visit: {
      id: visitId, propertyId: uid(2), tenancyId: uid(3), schemeCode: 'PLS', visitType: 'check_in', formVersionId: uid(4),
      officerId: uid(900), status: 'in_progress', scheduledAt: '2026-09-15T09:30:00+01:00', startedAt: '2026-09-15T09:34:00+01:00',
      completedAt: '2026-09-15T10:12:00+01:00', reportNumber: null, ...meta,
    },
    property: {
      id: uid(2), uprn: '128011234', addressLine1: '14 Acre Road', addressLine2: null, town: 'Kingston upon Thames',
      postcode: 'KT2 6EU', propertyType: '3-bed house', bedrooms: 3, landlordId: uid(5),
    },
    landlord: { id: uid(5), name: 'A. Pemberton', company: 'Pemberton Lettings Ltd', email: 'lettings@example.org', phone: null },
    tenancy: { id: uid(3), propertyId: uid(2), schemeCode: 'PLS', tenantName: 'To be allocated', startDate: null, endDate: null, status: 'pending' },
    general: [
      ['DESCRIPTION_OF_PROPERTY', 'Three-bedroom mid-terrace house over two floors, unfurnished.'],
      ['GENERAL_CONDITION', 'Good throughout.'],
      ['WINDOWS', 'UPVC Double Glazed'],
      ['HEATING', 'Central Heating'],
      ['FLOORING', 'Laminate to hallway; carpet to bedrooms.'],
      ['KEYS_HELD', '3 × front door, 2 × back door'],
    ].map(([fieldCode, value], i) => ({ id: uid(50 + i), visitId, fieldCode: fieldCode!, value: value!, ...meta })),
    appliances: [
      { id: uid(60), visitId, applianceCode: 'HOB', make: 'Bosch', model: 'PKE611CA1E', serial: '99-2281-0447', ...meta },
      { id: uid(61), visitId, applianceCode: 'OVEN', make: 'Zanussi', model: 'ZOB35301XK', serial: '4471-80212', ...meta },
      { id: uid(62), visitId, applianceCode: 'EXTRACTOR', make: null, model: null, serial: null, ...meta },
    ],
    meters: ['ELECTRICITY', 'GAS', 'WATER', 'STOPCOCK'].map((service, i) => ({
      id: uid(70 + i), visitId, service, location: i === 0 ? 'Meter cupboard, hallway' : null, readingIn: i === 0 ? '41872.6' : null,
      readingOut: null, photoId: null, ...meta,
    })),
    rooms,
    items,
    photos,
    notes: [{ id: uid(80), visitId, noteDate: '2026-09-15', note: 'Loft not accessed.', addedBy: 'P. Dekaate (PSSO)', signed: 'A.P. / P.D.', ...meta }],
    report: null,
    signatures: [],
  };
}
