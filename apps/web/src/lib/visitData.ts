import { useLiveQuery } from 'dexie-react-hooks';
import type {
  AdditionalNote, Appliance, ItemRecord, Landlord, MeterReading, Property, Report, RoomInstance, Tenancy, Visit, VisitGeneral,
} from '@soc/shared';
import { db, type LocalPhoto, type LocalSignature } from './db';

export interface VisitData {
  visit: Visit;
  property: Property | null;
  landlord: Landlord | null;
  tenancy: Tenancy | null;
  rooms: RoomInstance[];
  items: ItemRecord[];
  photos: LocalPhoto[];
  general: VisitGeneral[];
  appliances: Appliance[];
  meters: MeterReading[];
  notes: AdditionalNote[];
  report: Report | null;
  signatures: LocalSignature[];
}

export async function loadVisit(visitId: string): Promise<VisitData | null> {
  const visit = await db.visits.get(visitId);
  if (!visit) return null;
  const [property, rooms, items, photos, general, appliances, meters, notes, reports] = await Promise.all([
    db.properties.get(visit.propertyId),
    db.rooms.where('visitId').equals(visitId).toArray(),
    db.items.where('visitId').equals(visitId).toArray(),
    db.photos.where('visitId').equals(visitId).toArray(),
    db.general.where('visitId').equals(visitId).toArray(),
    db.appliances.where('visitId').equals(visitId).toArray(),
    db.meters.where('visitId').equals(visitId).toArray(),
    db.notes.where('visitId').equals(visitId).toArray(),
    db.reports.where('visitId').equals(visitId).toArray(),
  ]);
  const landlord = property?.landlordId ? (await db.landlords.get(property.landlordId)) ?? null : null;
  const tenancy = visit.tenancyId ? (await db.tenancies.get(visit.tenancyId)) ?? null : null;
  const report = reports[0] ?? null;
  const signatures = await db.signatures.where('visitId').equals(visitId).toArray();
  return {
    visit, property: property ?? null, landlord, tenancy,
    rooms: rooms.sort((a, b) => a.sortOrder - b.sortOrder),
    items: items.sort((a, b) => a.sortOrder - b.sortOrder),
    photos, general, appliances, meters,
    notes: notes.sort((a, b) => a.noteDate.localeCompare(b.noteDate)),
    report, signatures,
  };
}

/** undefined while loading, null if the visit is not on this device. */
export function useVisit(visitId: string | undefined): VisitData | null | undefined {
  return useLiveQuery(() => (visitId ? loadVisit(visitId) : Promise.resolve(null)), [visitId]);
}

export function addressOf(p: Property | null | undefined): string {
  if (!p) return 'Unknown property';
  return [p.addressLine1, p.addressLine2].filter(Boolean).join(', ');
}

export const VISIT_TYPE_LABEL: Record<string, string> = { check_in: 'Check-in', check_out: 'Check-out', interim: 'Interim' };
export const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Scheduled', in_progress: 'In progress', completed: 'Completed', issued: 'Issued', cancelled: 'Cancelled',
};
