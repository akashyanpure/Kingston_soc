import { useLiveQuery } from 'dexie-react-hooks';
import type { DescriptionPhrase, FormDefinition, ReferenceData } from '@soc/shared';
import { api } from './api';
import { db } from './db';

export function formOf(ref: ReferenceData | undefined | null): FormDefinition | null {
  return (ref?.formVersion?.definition as FormDefinition | undefined) ?? null;
}

export async function fetchReference(): Promise<ReferenceData> {
  const data = await api<ReferenceData>('/reference');
  await db.reference.put({ key: 'current', data, fetchedAt: new Date().toISOString() });
  return data;
}

export async function getReference(): Promise<ReferenceData | undefined> {
  return (await db.reference.get('current'))?.data;
}

/** undefined while loading, null when nothing is cached yet. */
export function useReference(): ReferenceData | null | undefined {
  return useLiveQuery(async () => (await db.reference.get('current'))?.data ?? null, []);
}

export function useForm(): FormDefinition | null | undefined {
  const ref = useReference();
  return ref === undefined ? undefined : formOf(ref);
}

export function phrasesFor(ref: ReferenceData | null | undefined, itemCode: string | null): DescriptionPhrase[] {
  if (!ref || !itemCode) return [];
  return ref.phrases.filter((p) => p.itemCode === itemCode).sort((a, b) => a.sortOrder - b.sortOrder);
}

export interface Abbreviation { code: string; meaning: string }

/**
 * The template's abbreviation key ("WP-White Plastic, PWE/PCE painted white/cream emulsion, …")
 * parsed into one-tap quick-picks. Condition codes (G-Good …) are left out.
 */
export function parseAbbreviations(key: string): Abbreviation[] {
  const body = key.replace(/^ABBREVIATION:\s*/i, '');
  const out: Abbreviation[] = [];
  for (const raw of body.split(/[,.]\s+/)) {
    const part = raw.trim().replace(/\.$/, '');
    const m = /^([A-Z][A-Z/]*[A-Z])\s*(?:-\s*|\s+)(.+)$/.exec(part);
    if (!m) continue;
    const [, code, meaning] = m as unknown as [string, string, string];
    if (['G', 'F', 'P', 'U', 'N/A'].includes(code)) continue;
    if (code === 'PWE/PCE') {
      out.push({ code: 'PWE', meaning: 'painted white emulsion' }, { code: 'PCE', meaning: 'painted cream emulsion' });
      continue;
    }
    out.push({ code, meaning: meaning.trim() });
  }
  return out;
}
