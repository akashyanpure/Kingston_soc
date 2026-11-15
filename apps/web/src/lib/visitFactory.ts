/**
 * Offline visit creation — mirrors docs/data-model.md "Visit creation" exactly:
 * one room_instance per template room (present = code ∈ presentRoomCodes), one
 * item_record per item of every present room (condition null), visit_general rows
 * for fields with defaults, one appliance row per appliance and one meter row per service.
 */
import type {
  Appliance, CreateVisitRequest, FormDefinition, ItemRecord, MeterReading, RoomInstance, VisitGeneral, Visit,
} from '@soc/shared';
import { db, tableFor } from './db';
import { commit, newId, type Create } from './mutations';

type Base = { updatedAt: string; updatedBy: string | null };
type Row<T> = Omit<T, keyof Base>;

export interface LocalVisitInput extends CreateVisitRequest {
  formVersionId: string;
  officerId: string;
}

export function itemRowsForRoom(form: FormDefinition, visitId: string, room: Pick<RoomInstance, 'id' | 'roomCode'>): Row<ItemRecord>[] {
  const def = form.rooms.find((r) => r.code === room.roomCode);
  return (def?.items ?? []).map((it, i) => ({
    id: newId(), visitId, roomInstanceId: room.id, itemCode: it.code, label: it.label, sortOrder: i,
    qty: null, description: null, condition: null, naReason: null, comment: null, dilapidation: null,
  }));
}

export function buildVisitCreates(form: FormDefinition, input: LocalVisitInput, startedAt: string): Create[] {
  const visitId = input.id;
  const present = new Set(input.presentRoomCodes);
  const visit: Row<Visit> = {
    id: visitId, propertyId: input.propertyId, tenancyId: input.tenancyId ?? null, schemeCode: input.schemeCode,
    visitType: input.visitType, formVersionId: input.formVersionId, officerId: input.officerId, status: 'in_progress',
    scheduledAt: input.scheduledAt ?? null, startedAt, completedAt: null, reportNumber: null,
  };
  const rooms: Row<RoomInstance>[] = form.rooms.map((r, i) => ({
    id: newId(), visitId, roomCode: r.code, label: r.label, sortOrder: i, present: present.has(r.code), widePhotoId: null,
  }));
  const items = rooms.filter((r) => r.present).flatMap((r) => itemRowsForRoom(form, visitId, r));
  const general: Row<VisitGeneral>[] = form.general
    .filter((g) => g.defaultValue !== undefined)
    .map((g) => ({ id: newId(), visitId, fieldCode: g.code, value: g.defaultValue ?? '' }));
  const appliances: Row<Appliance>[] = form.appliances.map((a) => ({
    id: newId(), visitId, applianceCode: a.code, make: null, model: null, serial: null,
  }));
  const meters: Row<MeterReading>[] = form.meters.map((m) => ({
    id: newId(), visitId, service: m.code, location: null, readingIn: null, readingOut: null, photoId: null,
  }));
  return [
    { entity: 'visit', row: visit },
    ...rooms.map((row) => ({ entity: 'room_instance' as const, row })),
    ...items.map((row) => ({ entity: 'item_record' as const, row })),
    ...general.map((row) => ({ entity: 'visit_general' as const, row })),
    ...appliances.map((row) => ({ entity: 'appliance' as const, row })),
    ...meters.map((row) => ({ entity: 'meter_reading' as const, row })),
  ];
}

/**
 * Offline creation: the rows are written to the device store only (no outbox mutations —
 * visits are never created through /sync/push). A queued `createVisit` action POSTs the
 * CreateVisitRequest when online (idempotent on the device-generated id); the sync engine
 * then adopts the server's rows (remapping room/item ids) before pushing this visit's edits.
 */
export async function createVisitLocally(form: FormDefinition, input: LocalVisitInput): Promise<void> {
  const at = new Date().toISOString();
  const creates = buildVisitCreates(form, input, at);
  const { formVersionId: _f, officerId: _o, ...request } = input;
  const payload: CreateVisitRequest = request;
  await db.transaction('rw', [db.visits, db.rooms, db.items, db.general, db.appliances, db.meters, db.pendingActions], async () => {
    for (const c of creates) await tableFor(c.entity).put({ ...c.row, updatedAt: at, updatedBy: input.officerId } as never);
    await db.pendingActions.add({ kind: 'createVisit', visitId: input.id, payload, status: 'pending', attempts: 0, createdAt: at });
  });
}

/** Mark a room present / not present; the device creates its item rows the first time it becomes present. */
export async function setRoomPresent(form: FormDefinition, room: RoomInstance, present: boolean, existingItemCount: number): Promise<void> {
  const creates: Create[] =
    present && existingItemCount === 0
      ? itemRowsForRoom(form, room.visitId, room).map((row) => ({ entity: 'item_record' as const, row }))
      : [];
  await commit(creates, [{ entity: 'room_instance', id: room.id, changes: { present } }]);
}
