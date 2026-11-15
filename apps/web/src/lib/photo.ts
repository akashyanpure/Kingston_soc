/**
 * Photo pipeline: resize to ~1600 px long edge, burn the photoStamp() text into a bottom
 * band (≤ 15 % of the height), encode JPEG q 0.8, SHA-256, store the Blob in Dexie.
 */
import type { Photo } from '@soc/shared';
import { db } from './db';
import { commit, newId, nowIso, type Edit } from './mutations';
import { sha256Blob } from './sha256';

export const LONG_EDGE = 1600;
export const JPEG_QUALITY = 0.8;
export const MAX_BAND = 0.15;

export interface ProcessedPhoto {
  blob: Blob;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
}

type Source = CanvasImageSource & { width?: number; height?: number };

async function decode(blob: Blob): Promise<{ img: Source; w: number; h: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return { img: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall back to <img> */
    }
  }
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  return { img, w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
}

/** Lay out the stamp: font size so 3 lines fit in ≤ 15 % of the height and the widest line fits the width. */
export function stampLayout(ctx: CanvasRenderingContext2D, w: number, h: number, lines: string[]) {
  const pad = Math.round(Math.max(8, w * 0.012));
  let size = Math.max(12, Math.round(h * 0.028));
  const fit = () => {
    ctx.font = `${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const band = Math.ceil(lines.length * size * 1.3 + pad * 2);
    return { widest, band };
  };
  let m = fit();
  while ((m.widest > w - pad * 2 || m.band > h * MAX_BAND) && size > 8) {
    size--;
    m = fit();
  }
  return { size, pad, band: Math.min(m.band, Math.floor(h * MAX_BAND)) };
}

export function drawStamp(ctx: CanvasRenderingContext2D, w: number, h: number, text: string): void {
  const lines = text.split('\n');
  const { size, pad, band } = stampLayout(ctx, w, h, lines);
  ctx.fillStyle = 'rgba(7, 41, 50, 0.9)';
  ctx.fillRect(0, h - band, w, band);
  ctx.fillStyle = '#f2f2f3';
  ctx.textBaseline = 'top';
  ctx.font = `${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  lines.forEach((line, i) => ctx.fillText(line, pad, h - band + pad + i * size * 1.3));
}

export async function processPhoto(source: Blob | HTMLVideoElement, stampText: string): Promise<ProcessedPhoto> {
  let img: Source, w: number, h: number, close = () => {};
  if (source instanceof Blob) {
    ({ img, w, h, close } = await decode(source));
  } else {
    img = source;
    w = source.videoWidth;
    h = source.videoHeight;
  }
  try {
    const scale = Math.min(1, LONG_EDGE / Math.max(w, h));
    const cw = Math.round(w * scale), ch = Math.round(h * scale);
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available on this device.');
    ctx.drawImage(img, 0, 0, cw, ch);
    drawStamp(ctx, cw, ch, stampText);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the photo.'))), 'image/jpeg', JPEG_QUALITY),
    );
    return { blob, width: cw, height: ch, bytes: blob.size, sha256: await sha256Blob(blob) };
  } finally {
    close();
  }
}

// ── GPS: once per room ────────────────────────────────────────────────────────
export interface Coords { lat: number; lng: number }
const roomFix = new Map<string, Promise<Coords | null>>();

export function roomPosition(roomKey: string): Promise<Coords | null> {
  let p = roomFix.get(roomKey);
  if (!p) {
    p = new Promise<Coords | null>((resolve) => {
      if (!('geolocation' in navigator)) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null), // denied / unavailable / timeout: stamp says "GPS unavailable"
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 120_000 },
      );
    });
    roomFix.set(roomKey, p);
    // A failed fix may be retried later in the same room.
    void p.then((c) => { if (!c) setTimeout(() => roomFix.delete(roomKey), 60_000); });
  }
  return p;
}

// ── store / attach / delete ───────────────────────────────────────────────────
export type PhotoTarget =
  | { kind: 'item'; roomInstanceId: string | null; itemRecordId: string }
  | { kind: 'wide'; roomInstanceId: string }
  | { kind: 'meter'; meterId: string };

export async function attachPhoto(
  visitId: string, target: PhotoTarget, processed: ProcessedPhoto,
  meta: { stampText: string; capturedAt: Date; coords: Coords | null },
): Promise<string> {
  const id = newId();
  const row: Omit<Photo, 'updatedAt' | 'updatedBy'> & { blob: Blob } = {
    id, visitId,
    roomInstanceId: target.kind === 'meter' ? null : target.roomInstanceId,
    itemRecordId: target.kind === 'item' ? target.itemRecordId : null,
    ref: null,
    capturedAt: meta.capturedAt.toISOString(),
    lat: meta.coords?.lat ?? null,
    lng: meta.coords?.lng ?? null,
    stampText: meta.stampText,
    sha256: processed.sha256,
    bytes: processed.bytes,
    width: processed.width,
    height: processed.height,
    uploaded: false,
    deletedAt: null,
    blob: processed.blob,
  };
  const edits: Edit[] = [];
  if (target.kind === 'wide') edits.push({ entity: 'room_instance', id: target.roomInstanceId, changes: { widePhotoId: id } });
  if (target.kind === 'meter') edits.push({ entity: 'meter_reading', id: target.meterId, changes: { photoId: id } });
  await commit([{ entity: 'photo', row }], edits);
  return id;
}

/** Retake/delete before sync removes the photo entirely; after sync it is soft-deleted. */
export async function deletePhoto(photoId: string): Promise<void> {
  const photo = await db.photos.get(photoId);
  if (!photo) return;
  const edits: Edit[] = [];
  const rooms = await db.rooms.where('visitId').equals(photo.visitId).filter((r) => r.widePhotoId === photoId).toArray();
  for (const r of rooms) edits.push({ entity: 'room_instance', id: r.id, changes: { widePhotoId: null } });
  const meters = await db.meters.where('visitId').equals(photo.visitId).filter((m) => m.photoId === photoId).toArray();
  for (const m of meters) edits.push({ entity: 'meter_reading', id: m.id, changes: { photoId: null } });

  const unsentCreate = await db.outbox.where('id').equals(photoId).filter((m) => m.status === 'pending' && 'sha256' in m.data).first();
  if (unsentCreate) {
    await db.transaction('rw', db.photos, db.outbox, async () => {
      await db.outbox.where('id').equals(photoId).delete();
      await db.photos.delete(photoId);
      // Unsent link edits must not point the server at a photo that will never arrive.
      const links = await db.outbox.where('status').equals('pending')
        .filter((m) => m.data.widePhotoId === photoId || m.data.photoId === photoId).toArray();
      for (const m of links) {
        const data = { ...m.data };
        if (data.widePhotoId === photoId) delete data.widePhotoId;
        if (data.photoId === photoId) delete data.photoId;
        if (Object.keys(data).every((k) => k === 'visitId')) await db.outbox.delete(m.seq!);
        else await db.outbox.update(m.seq!, { data });
      }
    });
    if (edits.length) await commit([], edits);
    return;
  }
  await commit([], [...edits, { entity: 'photo', id: photoId, changes: { deletedAt: nowIso() } }]);
  await db.photos.update(photoId, { blob: undefined });
}
