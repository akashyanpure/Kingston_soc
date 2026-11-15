import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { FormDefinition, ItemRecord, Photo, RoomInstance } from '@soc/shared';
import { db } from './db';
import { syncEngine, type SyncStatus } from './sync';

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(syncEngine.subscribe, syncEngine.getStatus, syncEngine.getStatus);
}

export interface QueueCounts { mutations: number; photos: number; actions: number; rejected: number; total: number }

export function useQueueCounts(): QueueCounts {
  return (
    useLiveQuery(async () => {
      const mutations = await db.outbox.where('status').equals('pending').count();
      const rejected = await db.outbox.where('status').equals('rejected').count();
      const photos = await db.photos.filter((p) => !p.uploaded && !p.deletedAt && !!p.blob).count();
      const actions = await db.pendingActions.where('status').equals('pending').count();
      return { mutations, photos, actions, rejected, total: mutations + photos + actions };
    }, []) ?? { mutations: 0, photos: 0, actions: 0, rejected: 0, total: 0 }
  );
}

/** Object URL for a Blob, revoked on change/unmount. */
export function useBlobUrl(blob: Blob | undefined | null): string | null {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return url;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

export interface Progress { graded: number; total: number; defects: number; pct: number }

export function progressOf(items: Pick<ItemRecord, 'condition'>[]): Progress {
  const total = items.length;
  const graded = items.filter((i) => i.condition !== null).length;
  const defects = items.filter((i) => i.condition === 'F' || i.condition === 'P' || i.condition === 'U').length;
  return { graded, total, defects, pct: total ? Math.round((graded / total) * 100) : 0 };
}

/** Items that count toward progress: those in present rooms, plus miscellaneous. */
export function relevantItems(rooms: RoomInstance[], items: ItemRecord[]): ItemRecord[] {
  const present = new Set(rooms.filter((r) => r.present).map((r) => r.id));
  return items.filter((i) => i.roomInstanceId === null || present.has(i.roomInstanceId));
}

export function livePhotos(photos: Photo[]): Photo[] {
  return photos.filter((p) => !p.deletedAt).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

export function conditionLabel(form: FormDefinition | null | undefined, code: string | null): string {
  if (!code) return 'Not graded';
  return form?.conditionOptions.find((c) => c.code === code)?.label ?? code;
}

/**
 * After data has rendered, scroll to the element named by location.hash (opening a
 * <details> on the way) and return its id so the screen can highlight it.
 */
export function useHashTarget(ready: boolean, hash: string): string | null {
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    if (!ready || !hash) return;
    const id = decodeURIComponent(hash.slice(1));
    const el = document.getElementById(id);
    if (!el) return;
    const details = el.closest('details') ?? (el instanceof HTMLDetailsElement ? el : null);
    if (details) details.open = true;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView?.({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    setTarget(id);
  }, [ready, hash]);
  return target;
}
