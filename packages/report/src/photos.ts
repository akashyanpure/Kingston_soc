import type { Photo, VisitBundle } from '@soc/shared';

type PhotoBundle = Pick<VisitBundle, 'rooms' | 'items' | 'photos' | 'meters'>;

/**
 * Photos that appear in the report: not deleted, and not attached to a room that is
 * not present (directly or through its item). Stable order: capturedAt, then id.
 * The server assigns refs P-1…P-n in exactly this order at issue.
 */
export function reportPhotos(bundle: PhotoBundle): Photo[] {
  const absentRooms = new Set(bundle.rooms.filter((r) => !r.present).map((r) => r.id));
  const itemRoom = new Map(bundle.items.map((i) => [i.id, i.roomInstanceId]));
  return bundle.photos
    .filter((p) => !p.deletedAt)
    .filter((p) => !(p.roomInstanceId && absentRooms.has(p.roomInstanceId)))
    .filter((p) => {
      if (!p.itemRecordId) return true;
      if (!itemRoom.has(p.itemRecordId)) return false; // item no longer exists
      const room = itemRoom.get(p.itemRecordId);
      return !(room && absentRooms.has(room));
    })
    .sort((a, b) => (a.capturedAt < b.capturedAt ? -1 : a.capturedAt > b.capturedAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Provisional refs in report order: P-1, P-2, … */
export function assignPhotoRefs(photos: Photo[]): Map<string, string> {
  return new Map(photos.map((p, i) => [p.id, `P-${i + 1}`]));
}

/** Refs to print: the server-assigned refs if every report photo has one, else provisional. */
export function photoRefMap(bundle: PhotoBundle): Map<string, string> {
  const photos = reportPhotos(bundle);
  if (photos.length > 0 && photos.every((p) => p.ref)) return new Map(photos.map((p) => [p.id, p.ref as string]));
  return assignPhotoRefs(photos);
}
