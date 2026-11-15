/**
 * Issue rules — the single implementation used by the device (review screen, button
 * state) and the server (POST /api/visits/:id/issue). Drafts may be incomplete;
 * these rules only gate issuing the report.
 */
import { DEFECT_CONDITIONS } from './enums.js';
import type { ItemRecord, Photo, RoomInstance, VisitGeneral } from './schemas.js';

export type BlockerCode =
  | 'NO_ROOMS_PRESENT'
  | 'ITEM_UNGRADED'
  | 'DEFECT_NO_COMMENT'
  | 'DEFECT_NO_PHOTO'
  | 'NA_NO_REASON'
  | 'ROOM_NO_WIDE_PHOTO'
  | 'GENERAL_MISSING'
  /** Server-side only check (apps/api serverIssueBlockers): a live photo whose file hasn't reached the server.
   *  The issue transaction locks the visit, after which photo uploads are rejected, so every photo must be uploaded first. */
  | 'PHOTO_NOT_UPLOADED';

export interface Blocker {
  code: BlockerCode;
  message: string;
  roomInstanceId?: string;
  itemRecordId?: string;
  photoId?: string;
}

export interface IssueInput {
  rooms: RoomInstance[];
  items: ItemRecord[];
  photos: Photo[];
  general: VisitGeneral[];
}

/** General-schedule fields that must be filled before issue. */
export const REQUIRED_GENERAL = ['DESCRIPTION_OF_PROPERTY', 'GENERAL_CONDITION'] as const;

export function issueBlockers({ rooms, items, photos, general }: IssueInput): Blocker[] {
  const blockers: Blocker[] = [];
  const present = rooms.filter((r) => r.present);
  const presentIds = new Set(present.map((r) => r.id));
  const livePhotos = photos.filter((p) => !p.deletedAt);
  const photosByItem = new Map<string, number>();
  for (const p of livePhotos) if (p.itemRecordId) photosByItem.set(p.itemRecordId, (photosByItem.get(p.itemRecordId) ?? 0) + 1);
  const photoIds = new Set(livePhotos.map((p) => p.id));

  if (present.length === 0) blockers.push({ code: 'NO_ROOMS_PRESENT', message: 'No rooms are marked as present.' });

  for (const code of REQUIRED_GENERAL) {
    const g = general.find((x) => x.fieldCode === code);
    if (!g || !g.value.trim()) blockers.push({ code: 'GENERAL_MISSING', message: `${code.replaceAll('_', ' ')} is empty.` });
  }

  for (const room of present) {
    if (!room.widePhotoId || !photoIds.has(room.widePhotoId))
      blockers.push({ code: 'ROOM_NO_WIDE_PHOTO', message: `${room.label}: wide room photo missing.`, roomInstanceId: room.id });
  }

  // Items in present rooms, plus miscellaneous items (roomInstanceId null).
  const relevant = items.filter((i) => i.roomInstanceId === null || presentIds.has(i.roomInstanceId));
  for (const item of relevant) {
    const where = { roomInstanceId: item.roomInstanceId ?? undefined, itemRecordId: item.id };
    const roomLabel = rooms.find((r) => r.id === item.roomInstanceId)?.label ?? 'MISCELLANEOUS';
    const name = `${roomLabel} / ${item.label}`;
    if (!item.condition) {
      blockers.push({ code: 'ITEM_UNGRADED', message: `${name}: not graded.`, ...where });
      continue;
    }
    if (item.condition === 'NA' && !item.naReason?.trim())
      blockers.push({ code: 'NA_NO_REASON', message: `${name}: N/A needs a reason.`, ...where });
    if (DEFECT_CONDITIONS.includes(item.condition)) {
      if (!item.comment?.trim()) blockers.push({ code: 'DEFECT_NO_COMMENT', message: `${name}: comment required.`, ...where });
      if (!photosByItem.get(item.id)) blockers.push({ code: 'DEFECT_NO_PHOTO', message: `${name}: photo required.`, ...where });
    }
  }
  return blockers;
}

/** Text burned into each photo and stored in photos.stamp_text. */
export function photoStamp(p: {
  address: string; postcode: string; capturedAt: Date; lat: number | null; lng: number | null;
  scheme: string; reportRef: string; room: string; item: string | null; officer: string;
}): string {
  const d = p.capturedAt;
  const pad = (n: number) => String(n).padStart(2, '0');
  const when = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const gps = p.lat !== null && p.lng !== null
    ? `${Math.abs(p.lat).toFixed(4)}°${p.lat >= 0 ? 'N' : 'S'} ${Math.abs(p.lng).toFixed(4)}°${p.lng >= 0 ? 'E' : 'W'}`
    : 'GPS unavailable';
  return [
    `${p.address.toUpperCase()}, ${p.postcode.toUpperCase()}`,
    `${when} · ${gps}`,
    `${p.scheme} · ${p.reportRef} · ${p.room}${p.item ? ' / ' + p.item : ''} · ${p.officer}`,
  ].join('\n');
}
