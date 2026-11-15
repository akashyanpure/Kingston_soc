/**
 * The only way the UI changes visit data: write the row to Dexie immediately and append
 * an outbox Mutation carrying only the changed fields (+ visitId) and clientUpdatedAt.
 */
import { v7 as uuidv7 } from 'uuid';
import type { SyncEntity, Visit } from '@soc/shared';
import { db, getMeta, tableFor, type OutboxEntry, type SessionUser } from './db';

/** Device-only fields that never travel in a mutation. */
const LOCAL_ONLY = new Set(['blob', 'updatedAt', 'updatedBy']);

export const newId = (): string => uuidv7();
export const nowIso = (): string => new Date().toISOString();

export interface Edit {
  entity: SyncEntity;
  id: string;
  changes: Record<string, unknown>;
}
export interface Create {
  entity: SyncEntity;
  row: { id: string } & Record<string, unknown>;
}

export class VisitLockedError extends Error {
  constructor() {
    super('This report has been issued and can no longer be changed.');
  }
}

function strip(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (!LOCAL_ONLY.has(k) && v !== undefined) out[k] = v;
  return out;
}

function sameValue(a: unknown, b: unknown): boolean {
  return a === b || (a == null && b == null);
}

function mutation(entity: SyncEntity, id: string, data: Record<string, unknown>, at: string): OutboxEntry {
  return { mutationId: uuidv7(), entity, op: 'upsert', id, data, clientUpdatedAt: at, status: 'pending', attempts: 0 };
}

const ALL_TABLES = () => [
  db.visits, db.general, db.appliances, db.meters, db.rooms, db.items, db.photos, db.notes, db.signatures, db.outbox, db.meta,
];

/**
 * Apply creates + edits atomically. If the parent visit is still 'scheduled', it moves to
 * 'in_progress' (startedAt) in the same transaction. Returns the number of mutations queued.
 */
export async function commit(creates: Create[], edits: Edit[]): Promise<number> {
  return db.transaction('rw', ALL_TABLES(), async () => {
    const at = nowIso();
    const user = await getMeta<SessionUser>('session');
    const updatedBy = user?.id ?? null;
    const queued: OutboxEntry[] = [];
    const visitIds = new Set<string>();

    for (const c of creates) {
      const table = tableFor(c.entity);
      const row = { ...c.row, updatedAt: at, updatedBy };
      await table.put(row as never);
      queued.push(mutation(c.entity, c.row.id, strip(c.row), at));
      visitIds.add(c.entity === 'visit' ? c.row.id : String(c.row.visitId));
    }

    for (const e of edits) {
      const table = tableFor(e.entity);
      const existing = (await table.get(e.id)) as Record<string, unknown> | undefined;
      if (!existing) throw new Error(`${e.entity} ${e.id} not found on this device`);
      const changed: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(e.changes)) if (!sameValue(existing[k], v)) changed[k] = v;
      const data = strip(changed);
      if (Object.keys(data).length === 0) continue;
      const visitId = e.entity === 'visit' ? e.id : String(existing.visitId);
      await table.update(e.id, { ...changed, updatedAt: at, updatedBy } as never);
      queued.push(mutation(e.entity, e.id, e.entity === 'visit' ? data : { ...data, visitId }, at));
      visitIds.add(visitId);
    }

    for (const visitId of visitIds) {
      const visit = await db.visits.get(visitId);
      if (!visit) continue;
      if (visit.status === 'issued') throw new VisitLockedError();
      const touchesStatus = queued.some((m) => m.entity === 'visit' && m.id === visitId && 'status' in m.data);
      if (visit.status === 'scheduled' && !touchesStatus) {
        const patch: Partial<Visit> = { status: 'in_progress', startedAt: visit.startedAt ?? at };
        await db.visits.update(visitId, { ...patch, updatedAt: at, updatedBy });
        queued.push(mutation('visit', visitId, patch, at));
      }
    }

    if (queued.length) await db.outbox.bulkAdd(queued);
    return queued.length;
  });
}

export const saveEdit = (entity: SyncEntity, id: string, changes: Record<string, unknown>) =>
  commit([], [{ entity, id, changes }]);

export const createRow = (entity: SyncEntity, row: Create['row']) => commit([{ entity, row }], []);

/** "MARK ALL AS GOOD": only ungraded items in rooms that are present (not miscellaneous). */
export async function markAllGood(visitId: string, roomInstanceId?: string): Promise<number> {
  const rooms = await db.rooms.where('visitId').equals(visitId).toArray();
  const present = new Set(rooms.filter((r) => r.present && (!roomInstanceId || r.id === roomInstanceId)).map((r) => r.id));
  const items = await db.items.where('visitId').equals(visitId).toArray();
  const targets = items.filter((i) => i.condition === null && i.roomInstanceId !== null && present.has(i.roomInstanceId));
  if (targets.length === 0) return 0;
  await commit([], targets.map((i) => ({ entity: 'item_record' as const, id: i.id, changes: { condition: 'G' } })));
  return targets.length;
}
