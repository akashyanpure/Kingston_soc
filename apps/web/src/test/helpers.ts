import { buildFormDefinition, type FormDefinition } from '@soc/shared';
import { v7 as uuidv7 } from 'uuid';
import { db, resetDbForTests, setMeta, type SocDb } from '../lib/db';
import { createVisitLocally, type LocalVisitInput } from '../lib/visitFactory';

export const OFFICER = { id: '0196f000-0000-7000-8000-0000000000a1', email: 'p.dekaate@kingston.test', name: 'P. Dekaate', role: 'officer' as const };

export async function freshDb(): Promise<SocDb> {
  const db = resetDbForTests(`test-${uuidv7()}`);
  await setMeta('session', OFFICER);
  return db;
}

export function form(): FormDefinition {
  return buildFormDefinition();
}

export function visitInput(f: FormDefinition, presentRoomCodes: string[]): LocalVisitInput {
  return {
    id: uuidv7(), propertyId: uuidv7(), tenancyId: null, schemeCode: 'PLS', visitType: 'check_in',
    presentRoomCodes, scheduledAt: null, formVersionId: uuidv7(), officerId: OFFICER.id,
  };
}

export async function seedVisit(f: FormDefinition, presentRoomCodes: string[]) {
  const input = visitInput(f, presentRoomCodes);
  await db.properties.put({
    id: input.propertyId, uprn: null, addressLine1: '14 Acre Road', addressLine2: null, town: 'Kingston upon Thames',
    postcode: 'KT2 6EU', propertyType: '2-bed flat', bedrooms: 2, landlordId: null,
  });
  await createVisitLocally(f, input);
  return input.id;
}
