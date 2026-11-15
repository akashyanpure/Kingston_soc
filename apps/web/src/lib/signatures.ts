/**
 * E-signatures before issue (decision 2026-11-15). Each person signs the draft on the phone;
 * the row stores visitContentHash() of exactly what they were shown. Any later content change
 * makes the signature stale (SIGNATURE_STALE) until they sign again. One row per role; re-signing
 * updates the same row with a new image + hash.
 */
import { visitContentHash, type FormDefinition, type SignatureRole, type VisitType } from '@soc/shared';
import type { LocalSignature } from './db';
import { commit, newId, nowIso } from './mutations';
import { loadVisit, type VisitData } from './visitData';

/** visitContentHash of the device's current copy (photo blobs and other local-only fields removed). */
export function contentHashOf(d: VisitData): string | null {
  if (!d.property) return null;
  return visitContentHash({
    visit: d.visit, property: d.property, landlord: d.landlord, tenancy: d.tenancy,
    general: d.general, appliances: d.appliances, meters: d.meters, rooms: d.rooms, items: d.items,
    photos: d.photos.map(({ blob: _b, ...p }) => p), notes: d.notes,
  });
}

/** Roles that may sign this visit: officer + landlord/agent always; the tenant role matching the visit type. */
export function rolesFor(form: FormDefinition, visitType: VisitType): FormDefinition['signatureRoles'] {
  return form.signatureRoles.filter(({ role }) =>
    role === 'tenant_check_in' ? visitType === 'check_in' : role === 'tenant_check_out' ? visitType === 'check_out' : true);
}

export const isStale = (s: Pick<LocalSignature, 'contentSha256'>, hash: string | null) => !!hash && s.contentSha256 !== hash;

/** Sign (or re-sign) the current draft as `role`. Returns the signature id. */
export async function signVisit(visitId: string, role: SignatureRole, name: string, imageDataUrl: string): Promise<string> {
  const data = await loadVisit(visitId);
  if (!data) throw new Error('Visit not found on this device.');
  const contentSha256 = contentHashOf(data);
  if (!contentSha256) throw new Error('The property details are missing, so the draft cannot be signed yet.');
  const signedAt = nowIso();
  const existing = data.signatures.find((s) => s.role === role && s.method === 'on_device');
  if (existing) {
    await commit([], [{
      entity: 'signature', id: existing.id,
      changes: { name: name.trim(), imageDataUrl, contentSha256, signedAt, hasImage: true },
    }]);
    return existing.id;
  }
  const row: Omit<LocalSignature, 'updatedAt' | 'updatedBy'> = {
    id: newId(), visitId, reportId: null, role, name: name.trim(), method: 'on_device', signedAt,
    contentSha256, reportSha256: null, hasImage: true, imageDataUrl,
  };
  await commit([{ entity: 'signature', row }], []);
  return row.id;
}
