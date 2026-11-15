import { buildFormDefinition, type FormDefinition } from '@soc/shared';
import { v7 as uuidv7 } from 'uuid';
import { resetDbForTests, setMeta, type SocDb } from '../lib/db';
import { createVisitLocally, type LocalVisitInput } from '../lib/visitFactory';

export const OFFICER = { id: '0196f000-0000-7000-8000-0000000000a1', email: 'j.patel@example.org', name: 'J. Patel', role: 'officer' as const };

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
  await createVisitLocally(f, input);
  return input.id;
}
