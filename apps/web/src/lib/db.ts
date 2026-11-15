/**
 * Device store (IndexedDB via Dexie). Tables mirror the entity schemas in
 * @soc/shared/schemas.ts, plus the sync outbox, cached reference data and meta.
 * Every edit is written here first; the sync engine pushes the outbox when online.
 */
import Dexie, { type EntityTable } from 'dexie';
import type {
  AdditionalNote, Appliance, ItemRecord, Landlord, MeterReading, Mutation, Photo, Property,
  ReferenceData, Report, RoomInstance, Signature, SyncEntity, Tenancy, User,
  Visit, VisitGeneral,
} from '@soc/shared';

/** Photo row + the stamped JPEG kept on the device (needed offline and for the draft preview). */
export interface LocalPhoto extends Photo {
  blob?: Blob;
}

export type OutboxStatus = 'pending' | 'rejected';
export interface OutboxEntry extends Mutation {
  seq?: number;
  status: OutboxStatus;
  attempts: number;
  error?: string;
}

/** Work that needs a plain API call (not a sync mutation): run in order by the sync engine. */
export type PendingActionKind = 'createProperty' | 'createVisit' | 'issue';
export interface PendingAction {
  seq?: number;
  kind: PendingActionKind;
  visitId: string | null;
  payload: unknown;
  status: 'pending' | 'failed' | 'done';
  attempts: number;
  error?: string;
  createdAt: string;
}

/**
 * On-device e-signature (decision 2026-11-15): a visit row like any other, synced as entity
 * 'signature'. The PNG data URL is kept on the device for display/preview and sent once in
 * the push data (write-only on the server, which then serves GET /signatures/:id/image).
 */
export interface LocalSignature extends Signature {
  imageDataUrl?: string;
}

export interface ReferenceRow { key: 'current'; data: ReferenceData; fetchedAt: string }
export interface MetaRow { key: string; value: unknown }
export type SessionUser = Pick<User, 'id' | 'email' | 'name' | 'role'>;

export class SocDb extends Dexie {
  visits!: EntityTable<Visit, 'id'>;
  properties!: EntityTable<Property, 'id'>;
  landlords!: EntityTable<Landlord, 'id'>;
  tenancies!: EntityTable<Tenancy, 'id'>;
  general!: EntityTable<VisitGeneral, 'id'>;
  appliances!: EntityTable<Appliance, 'id'>;
  meters!: EntityTable<MeterReading, 'id'>;
  rooms!: EntityTable<RoomInstance, 'id'>;
  items!: EntityTable<ItemRecord, 'id'>;
  photos!: EntityTable<LocalPhoto, 'id'>;
  notes!: EntityTable<AdditionalNote, 'id'>;
  reports!: EntityTable<Report, 'id'>;
  signatures!: EntityTable<LocalSignature, 'id'>;
  outbox!: EntityTable<OutboxEntry, 'seq'>;
  pendingActions!: EntityTable<PendingAction, 'seq'>;
  reference!: EntityTable<ReferenceRow, 'key'>;
  meta!: EntityTable<MetaRow, 'key'>;

  constructor(name = 'kingston-soc') {
    super(name);
    this.version(1).stores({
      visits: 'id, officerId, status, scheduledAt, updatedAt',
      properties: 'id, postcode',
      landlords: 'id',
      tenancies: 'id, propertyId',
      general: 'id, visitId, [visitId+fieldCode]',
      appliances: 'id, visitId',
      meters: 'id, visitId',
      rooms: 'id, visitId',
      items: 'id, visitId, roomInstanceId',
      photos: 'id, visitId, itemRecordId, roomInstanceId',
      notes: 'id, visitId',
      reports: 'id, visitId',
      signatures: 'id, reportId',
      signatureDrafts: 'key, visitId',
      outbox: '++seq, mutationId, id, status',
      pendingActions: '++seq, kind, visitId, status',
      reference: 'key',
      meta: 'key',
    });
    // v2: signatures belong to the visit and are created on the device before issue.
    this.version(2).stores({
      signatures: 'id, reportId, visitId, [visitId+role]',
      signatureDrafts: null,
    });
  }
}

export let db = new SocDb();

/** Tests use a fresh database per case. */
export function resetDbForTests(name: string): SocDb {
  db = new SocDb(name);
  return db;
}

/** Sync entity → device table. */
export function tableFor(entity: SyncEntity) {
  switch (entity) {
    case 'visit': return db.visits;
    case 'visit_general': return db.general;
    case 'appliance': return db.appliances;
    case 'meter_reading': return db.meters;
    case 'room_instance': return db.rooms;
    case 'item_record': return db.items;
    case 'photo': return db.photos;
    case 'additional_note': return db.notes;
    case 'signature': return db.signatures;
  }
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}
export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}
