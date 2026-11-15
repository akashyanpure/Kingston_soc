/**
 * Sync engine (device → server, then server → device).
 *
 * One run, in order:
 *   1. pending API actions that must precede pushes: POST /properties, then POST /visits for
 *      visits created offline (idempotent on the device id). The server's rows are adopted and
 *      local room/item ids remapped; a visit's mutations are held back until this has succeeded.
 *   2. push the outbox in batches, ordered visit → rooms → items → others → photos (sync.ts).
 *      Two refinements: a photo row travels in the same batch as the room/meter edit that points
 *      at it, and a room's present=true goes after the item rows the device created for it (so
 *      the server's ensureRoomItems does not create a second set).
 *   3. upload photo binaries whose row has been accepted (PUT /photos/:id/file, x-sha256)
 *   4. queued "issue report" actions once that visit has nothing left to push
 *   5. pull assigned visits (GET /visits, GET /visits/:id) and reference data
 * Transient failures back off exponentially (2 s → 60 s). Mutations are idempotent
 * server-side (mutationId), so a batch whose response was lost is simply re-sent.
 * Everything lives in IndexedDB, so a reload or app kill just resumes.
 */
import type {
  MutationResult, PushRequest, PushResponse, Report, SyncEntity, VisitBundle, VisitSummary,
} from '@soc/shared';
import { api, apiRaw, HttpError, isServiceOffline, isTransient, SERVICE_OFFLINE_RETRY_MS } from './api';
import { db, getMeta, setMeta, type OutboxEntry, type PendingAction, type SessionUser } from './db';
import { fetchReference } from './reference';
import { newId, saveEdit } from './mutations';

const RANK: Record<SyncEntity, number> = {
  visit: 0,
  room_instance: 1,
  item_record: 2,
  visit_general: 3,
  appliance: 3,
  meter_reading: 3,
  additional_note: 3,
  photo: 4,
  signature: 5, // last: a signature binds to all of the content above
};

function rankOf(m: Pick<OutboxEntry, 'entity' | 'data'>): number {
  if (m.entity === 'room_instance' && m.data?.present === true) return 2.5;
  return RANK[m.entity];
}

/** Stable sort: entity rank first, then the order the edits were made in. */
export function orderForPush<T extends Pick<OutboxEntry, 'entity' | 'seq' | 'data'>>(entries: T[]): T[] {
  return [...entries].sort((a, b) => rankOf(a) - rankOf(b) || (a.seq ?? 0) - (b.seq ?? 0));
}

const visitOf = (m: Pick<OutboxEntry, 'entity' | 'id' | 'data'>) => (m.entity === 'visit' ? m.id : String(m.data.visitId));

/** 'off' = the server is switched off (SERVICE_OFFLINE): like being offline, work stays queued. */
export type SyncPhase = 'idle' | 'syncing' | 'error' | 'auth' | 'off';
export interface SyncStatus {
  online: boolean;
  phase: SyncPhase;
  lastSyncAt: string | null;
  lastError: string | null;
}
export interface RunResult {
  pushed: number;
  rejected: number;
  uploaded: number;
  issued: number;
  pulled: number;
  error?: string;
}

export async function getDeviceId(): Promise<string> {
  let id = await getMeta<string>('deviceId');
  if (!id) {
    id = newId();
    await setMeta('deviceId', id);
  }
  return id;
}

export interface IssuePayload {
  reportId?: string;
}

export class SyncEngine {
  batchSize = 200;
  pullEnabled = true;
  private status: SyncStatus = {
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    phase: 'idle', lastSyncAt: null, lastError: null,
  };
  private listeners = new Set<() => void>();
  private running: Promise<RunResult> | null = null;
  private again = false;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastPull = 0;

  // ── observable status (useSyncExternalStore) ────────────────────────────────
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getStatus = () => this.status;
  private set(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    for (const fn of this.listeners) fn();
  }

  // ── scheduling ──────────────────────────────────────────────────────────────
  start(): void {
    if (typeof window === 'undefined' || this.interval) return;
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    document.addEventListener('visibilitychange', this.onVisible);
    this.interval = setInterval(() => void this.syncNow(), 30_000);
    void this.syncNow();
  }
  stop(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    document.removeEventListener('visibilitychange', this.onVisible);
    if (this.interval) clearInterval(this.interval);
    if (this.timer) clearTimeout(this.timer);
    this.interval = null;
    this.timer = null;
  }
  private onOnline = () => {
    this.set({ online: true });
    this.failures = 0;
    void this.syncNow();
  };
  private onOffline = () => this.set({ online: false });
  private onVisible = () => {
    if (document.visibilityState === 'visible') void this.syncNow();
  };

  /** Call after local edits: debounced push. */
  notifyChange(delay = 800): void {
    this.schedule(delay);
  }
  private schedule(delay: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.syncNow();
    }, delay);
  }

  /** Run now (or once more after the current run). Never throws. */
  syncNow(opts: { pull?: boolean } = {}): Promise<RunResult> {
    if (opts.pull) this.lastPull = 0;
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.runOnce().finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        void this.syncNow();
      }
    });
    return this.running;
  }

  async runOnce(): Promise<RunResult> {
    const result: RunResult = { pushed: 0, rejected: 0, uploaded: 0, issued: 0, pulled: 0 };
    const online = typeof navigator === 'undefined' ? true : navigator.onLine;
    if (!online) {
      this.set({ online: false });
      return result;
    }
    const user = await getMeta<SessionUser>('session');
    if (!user) {
      this.set({ online: true, phase: 'auth' });
      return result;
    }
    this.set({ online: true, phase: 'syncing' });
    try {
      await this.runPropertyActions();
      await this.runVisitCreateActions();
      const pushed = await this.pushOutbox();
      result.pushed = pushed.applied;
      result.rejected = pushed.rejected;
      result.uploaded = await this.uploadPhotos();
      result.issued = await this.runIssueActions();
      if (this.pullEnabled && Date.now() - this.lastPull > 60_000) {
        result.pulled = await this.pull();
        this.lastPull = Date.now();
      }
      this.failures = 0;
      this.set({ phase: 'idle', lastSyncAt: new Date().toISOString(), lastError: null });
    } catch (e) {
      result.error = e instanceof Error ? e.message : String(e);
      if (isServiceOffline(e)) {
        // Calm state: nothing is wrong on the device; check again in ~5 minutes.
        this.set({ phase: 'off', lastError: null });
        this.schedule(SERVICE_OFFLINE_RETRY_MS);
      } else if (e instanceof HttpError && e.status === 401) {
        this.set({ phase: 'auth', lastError: 'Sign in again to upload your work.' });
      } else {
        this.failures++;
        this.set({ phase: 'error', lastError: result.error });
        if (isTransient(e) || !(e instanceof HttpError)) {
          this.schedule(Math.min(2000 * 2 ** (this.failures - 1), 60_000));
        }
      }
    }
    return result;
  }

  // ── 1. API actions that must run before pushes ──────────────────────────────
  private async runPropertyActions(): Promise<void> {
    const actions = await db.pendingActions.where('kind').equals('createProperty').filter((a) => a.status === 'pending').sortBy('seq');
    for (const a of actions) {
      try {
        await api('/properties', { method: 'POST', json: a.payload });
        await db.pendingActions.update(a.seq!, { status: 'done' });
      } catch (e) {
        if (e instanceof HttpError && e.status === 409) {
          await db.pendingActions.update(a.seq!, { status: 'done' }); // already created (lost response)
          continue;
        }
        if (isTransient(e) || (e instanceof HttpError && e.status === 401)) throw e;
        await db.pendingActions.update(a.seq!, { status: 'failed', attempts: a.attempts + 1, error: (e as Error).message });
      }
    }
  }

  async runVisitCreateActions(): Promise<void> {
    const actions = await db.pendingActions.where('kind').equals('createVisit').filter((a) => a.status === 'pending').sortBy('seq');
    for (const a of actions) {
      try {
        const bundle = await api<VisitBundle>('/visits', { method: 'POST', json: a.payload });
        await adoptServerBundle(bundle);
        await db.pendingActions.update(a.seq!, { status: 'done' });
      } catch (e) {
        if (isTransient(e) || (e instanceof HttpError && e.status === 401)) throw e;
        await db.pendingActions.update(a.seq!, { status: 'failed', attempts: a.attempts + 1, error: (e as Error).message });
      }
    }
  }

  // ── 2. outbox ───────────────────────────────────────────────────────────────
  async pushOutbox(): Promise<{ applied: number; rejected: number }> {
    const deviceId = await getDeviceId();
    let applied = 0;
    let rejected = 0;
    for (;;) {
      const held = new Set(
        (await db.pendingActions.where('kind').equals('createVisit').filter((a) => a.status !== 'done').toArray()).map((a) => a.visitId!),
      );
      const pending = (await db.outbox.where('status').equals('pending').toArray()).filter((m) => !held.has(visitOf(m)));
      if (pending.length === 0) break;
      const ordered = orderForPush(pending);
      const picked = new Set(ordered.slice(0, this.batchSize));
      // Photo rows go with (not after) the room/meter edits that reference them.
      for (const m of [...picked]) {
        for (const ref of [m.data.widePhotoId, m.data.photoId]) {
          if (typeof ref !== 'string') continue;
          for (const pm of ordered) if (pm.entity === 'photo' && pm.id === ref) picked.add(pm);
        }
      }
      const batch = orderForPush([...picked]);
      const body: PushRequest = {
        deviceId,
        mutations: batch.map(({ mutationId, entity, op, id, data, clientUpdatedAt }) => ({ mutationId, entity, op, id, data, clientUpdatedAt })),
      };
      let res: PushResponse;
      try {
        res = await api<PushResponse>('/sync/push', { method: 'POST', json: body });
      } catch (e) {
        await db.outbox.bulkUpdate(batch.map((m) => ({ key: m.seq!, changes: { attempts: m.attempts + 1 } })));
        if (e instanceof HttpError && e.status === 400) {
          // The whole batch was malformed: park it so the rest of the queue can move.
          await db.outbox.bulkUpdate(batch.map((m) => ({ key: m.seq!, changes: { status: 'rejected' as const, error: e.message } })));
          rejected += batch.length;
          continue;
        }
        throw e;
      }
      const byId = new Map<string, MutationResult>(res.results.map((r) => [r.mutationId, r]));
      let matched = 0;
      await db.transaction('rw', db.outbox, async () => {
        for (const m of batch) {
          const r = byId.get(m.mutationId);
          if (!r) continue;
          matched++;
          if (r.status === 'rejected') {
            rejected++;
            await db.outbox.update(m.seq!, { status: 'rejected', error: r.error ?? 'Rejected by server', attempts: m.attempts + 1 });
          } else {
            applied++;
            await db.outbox.delete(m.seq!);
          }
        }
      });
      if (matched === 0) throw new Error('Sync server returned no results for the batch.');
    }
    return { applied, rejected };
  }

  // ── 3. photo binaries ───────────────────────────────────────────────────────
  async uploadPhotos(): Promise<number> {
    const waiting = await db.photos.filter((p) => !p.uploaded && !p.deletedAt && !!p.blob).toArray();
    if (waiting.length === 0) return 0;
    const unsent = new Set((await db.outbox.toArray()).filter((m) => m.entity === 'photo').map((m) => m.id));
    let uploaded = 0;
    for (const p of waiting) {
      if (unsent.has(p.id)) continue; // row not accepted yet
      try {
        await apiRaw(`/photos/${p.id}/file`, {
          method: 'PUT',
          headers: { 'content-type': 'image/jpeg', 'x-sha256': p.sha256 },
          body: p.blob!,
        });
        await db.photos.update(p.id, { uploaded: true });
        uploaded++;
      } catch (e) {
        if (isTransient(e) || (e instanceof HttpError && e.status === 401)) throw e;
        console.warn('Photo upload rejected', p.id, e);
      }
    }
    return uploaded;
  }

  // ── 4. issue ────────────────────────────────────────────────────────────────
  async runIssueActions(): Promise<number> {
    const actions = await db.pendingActions.where('kind').equals('issue').filter((a) => a.status === 'pending').sortBy('seq');
    let issued = 0;
    for (const a of actions) {
      const visitId = a.visitId!;
      const payload = (a.payload ?? {}) as IssuePayload;
      if (!payload.reportId && !(await this.visitFullySynced(visitId))) continue;
      try {
        if (!payload.reportId) {
          let report: Report | null = null;
          try {
            report = (await api<{ report: Report }>(`/visits/${visitId}/issue`, { method: 'POST' })).report;
          } catch (e) {
            if (!(e instanceof HttpError && e.status === 409)) throw e;
            // Maybe already issued (lost response) — otherwise it's real blockers.
            const bundle = await api<VisitBundle>(`/visits/${visitId}`);
            if (!bundle.report) {
              const blockers = (e.details as { blockers?: { message: string }[] } | undefined)?.blockers;
              await db.pendingActions.update(a.seq!, {
                status: 'failed', attempts: a.attempts + 1,
                error: blockers?.length ? blockers.map((b) => b.message).join('\n') : e.message,
              });
              continue;
            }
            report = bundle.report;
          }
          payload.reportId = report.id;
          await db.transaction('rw', db.reports, db.visits, db.pendingActions, async () => {
            await db.reports.put(report!);
            await db.visits.update(visitId, { status: 'issued', reportNumber: report!.reportNumber });
            await db.pendingActions.update(a.seq!, { payload });
          });
          issued++;
        }
        await db.pendingActions.update(a.seq!, { status: 'done', payload });
      } catch (e) {
        await db.pendingActions.update(a.seq!, { attempts: a.attempts + 1, error: (e as Error).message });
        if (isTransient(e) || (e instanceof HttpError && e.status === 401)) throw e;
        await db.pendingActions.update(a.seq!, { status: 'failed' });
      }
    }
    return issued;
  }

  async visitFullySynced(visitId: string): Promise<boolean> {
    const creating = await db.pendingActions.where('visitId').equals(visitId).filter((a) => a.kind === 'createVisit' && a.status !== 'done').count();
    if (creating > 0) return false;
    const pending = await db.outbox.where('status').equals('pending').filter((m) => m.id === visitId || m.data.visitId === visitId).count();
    if (pending > 0) return false;
    const photos = await db.photos.where('visitId').equals(visitId).filter((p) => !p.uploaded && !p.deletedAt && !!p.blob).count();
    return photos === 0;
  }

  // ── 5. pull ─────────────────────────────────────────────────────────────────
  async pull(): Promise<number> {
    const ref = await db.reference.get('current');
    if (!ref || Date.now() - Date.parse(ref.fetchedAt) > 60 * 60_000) await fetchReference();
    const { visits } = await api<{ visits: VisitSummary[] }>('/visits');
    let pulled = 0;
    for (const s of visits) {
      const local = await db.visits.get(s.id);
      if (local && Date.parse(local.updatedAt) >= Date.parse(s.updatedAt) && local.status === s.status) continue;
      const bundle = await api<VisitBundle>(`/visits/${s.id}`);
      await mergeBundle(bundle);
      pulled++;
    }
    return pulled;
  }
}

/**
 * Store a server bundle, keeping unsent local changes on top (pending outbox data is
 * re-applied over the server row) and the local photo blobs.
 */
export async function mergeBundle(b: VisitBundle): Promise<void> {
  const tables = [db.visits, db.properties, db.landlords, db.tenancies, db.general, db.appliances, db.meters, db.rooms, db.items, db.photos, db.notes, db.reports, db.signatures, db.outbox];
  await db.transaction('rw', tables, async () => {
    const pending = await db.outbox.where('status').equals('pending').sortBy('seq');
    const overlay = new Map<string, Record<string, unknown>>();
    for (const m of pending) overlay.set(m.id, { ...(overlay.get(m.id) ?? {}), ...m.data });
    const withLocal = <T extends { id: string }>(row: T): T => ({ ...row, ...(overlay.get(row.id) ?? {}) }) as T;

    await db.visits.put(withLocal(b.visit));
    await db.properties.put(b.property);
    if (b.landlord) await db.landlords.put(b.landlord);
    if (b.tenancy) await db.tenancies.put(b.tenancy);
    await db.general.bulkPut(b.general.map(withLocal));
    await db.appliances.bulkPut(b.appliances.map(withLocal));
    await db.meters.bulkPut(b.meters.map(withLocal));
    await db.rooms.bulkPut(b.rooms.map(withLocal));
    await db.items.bulkPut(b.items.map(withLocal));
    await db.notes.bulkPut(b.notes.map(withLocal));
    for (const p of b.photos) {
      const local = await db.photos.get(p.id);
      await db.photos.put({ ...withLocal(p), ...(local?.blob ? { blob: local.blob } : {}) });
    }
    if (b.report) await db.reports.put(b.report);
    for (const sig of b.signatures) {
      const local = await db.signatures.get(sig.id);
      await db.signatures.put({ ...withLocal(sig), ...(local?.imageDataUrl ? { imageDataUrl: local.imageDataUrl } : {}) });
    }
  });
}

/**
 * After POST /visits succeeds for a visit created offline: the server generated its own ids
 * for rooms, items, general, appliance and meter rows. Map ours onto theirs (room by roomCode,
 * item by room + itemCode, general by fieldCode, appliance by code, meter by service), rewrite
 * the device rows, photos and queued mutations to the server ids, then merge the bundle.
 * Rows the server does not have (extra items, rooms made present later…) keep their ids and
 * are pushed as new rows.
 */
export async function adoptServerBundle(b: VisitBundle): Promise<void> {
  const visitId = b.visit.id;
  const localVisit = await db.visits.get(visitId);
  const tables = [db.rooms, db.items, db.general, db.appliances, db.meters, db.photos, db.outbox];
  await db.transaction('rw', tables, async () => {
    const map = new Map<string, string>();
    const taken = new Set<string>();
    const link = (local: string, server: string | undefined) => {
      if (!server || server === local || taken.has(server)) return;
      map.set(local, server);
      taken.add(server);
    };
    const rooms = await db.rooms.where('visitId').equals(visitId).toArray();
    for (const r of rooms) link(r.id, b.rooms.find((x) => x.roomCode === r.roomCode && !taken.has(x.id))?.id);
    const items = await db.items.where('visitId').equals(visitId).toArray();
    for (const i of items) {
      if (!i.itemCode || !i.roomInstanceId) continue;
      const room = map.get(i.roomInstanceId) ?? i.roomInstanceId;
      link(i.id, b.items.find((x) => x.roomInstanceId === room && x.itemCode === i.itemCode && !taken.has(x.id))?.id);
    }
    const general = await db.general.where('visitId').equals(visitId).toArray();
    for (const g of general) link(g.id, b.general.find((x) => x.fieldCode === g.fieldCode)?.id);
    const appliances = await db.appliances.where('visitId').equals(visitId).toArray();
    for (const a of appliances) link(a.id, b.appliances.find((x) => x.applianceCode === a.applianceCode)?.id);
    const meters = await db.meters.where('visitId').equals(visitId).toArray();
    for (const m of meters) link(m.id, b.meters.find((x) => x.service === m.service)?.id);
    if (map.size === 0) return;
    const re = (id: string | null): string | null => (id ? map.get(id) ?? id : null);

    for (const r of rooms) if (map.has(r.id)) { await db.rooms.delete(r.id); await db.rooms.put({ ...r, id: re(r.id)! }); }
    for (const i of items) {
      const next = { ...i, id: re(i.id)!, roomInstanceId: re(i.roomInstanceId) };
      if (next.id !== i.id) await db.items.delete(i.id);
      await db.items.put(next);
    }
    for (const g of general) if (map.has(g.id)) { await db.general.delete(g.id); await db.general.put({ ...g, id: re(g.id)! }); }
    for (const a of appliances) if (map.has(a.id)) { await db.appliances.delete(a.id); await db.appliances.put({ ...a, id: re(a.id)! }); }
    for (const m of meters) if (map.has(m.id)) { await db.meters.delete(m.id); await db.meters.put({ ...m, id: re(m.id)! }); }
    for (const p of await db.photos.where('visitId').equals(visitId).toArray()) {
      await db.photos.update(p.id, { roomInstanceId: re(p.roomInstanceId), itemRecordId: re(p.itemRecordId) });
    }
    for (const m of await db.outbox.toArray()) {
      if (visitOf(m) !== visitId) continue;
      const data = { ...m.data };
      for (const k of ['roomInstanceId', 'itemRecordId'] as const) if (typeof data[k] === 'string') data[k] = re(data[k] as string);
      await db.outbox.update(m.seq!, { id: re(m.id)!, data });
    }
  });
  await mergeBundle(b);
  // The server creates the visit as given by CreateVisitRequest (status 'scheduled'); keep the
  // device's "work has started" state by pushing it as an ordinary edit.
  if (localVisit?.status === 'in_progress' && b.visit.status === 'scheduled') {
    await saveEdit('visit', visitId, { status: 'in_progress', startedAt: localVisit.startedAt ?? new Date().toISOString() });
  }
}

export async function queueIssue(visitId: string): Promise<void> {
  const existing = await db.pendingActions.where('visitId').equals(visitId).filter((a) => a.kind === 'issue' && a.status !== 'done').first();
  if (existing) {
    await db.pendingActions.update(existing.seq!, { status: 'pending', error: undefined });
    return;
  }
  const action: PendingAction = { kind: 'issue', visitId, payload: {}, status: 'pending', attempts: 0, createdAt: new Date().toISOString() };
  await db.pendingActions.add(action);
}

export const syncEngine = new SyncEngine();
