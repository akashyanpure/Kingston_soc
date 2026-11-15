import { createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { formVersions, schemes, users, visits } from '@soc/db';
import type { Db } from '@soc/db';
import { SCHEMES } from '@soc/shared';
import type { FormDefinition, User } from '@soc/shared';
import { assertCanAccessVisit } from '../auth/index.js';
import { notFound } from '../errors.js';

export type VisitRow = typeof visits.$inferSelect;

/** Load a live visit and check the user may see it (404 / 403). */
export async function getVisitForUser(db: Db, user: User, visitId: string, opts: { forUpdate?: boolean } = {}): Promise<VisitRow> {
  const q = db.select().from(visits).where(and(eq(visits.id, visitId), isNull(visits.deletedAt))).limit(1);
  const [row] = opts.forUpdate ? await q.for('update') : await q;
  if (!row) throw notFound('Visit');
  assertCanAccessVisit(user, row);
  return row;
}

export async function getFormDefinition(db: Db, formVersionId: string): Promise<FormDefinition> {
  const [row] = await db.select({ definition: formVersions.definition }).from(formVersions).where(eq(formVersions.id, formVersionId)).limit(1);
  if (!row) throw notFound('Form version');
  return row.definition as FormDefinition;
}

export async function getSchemeName(db: Db, code: string): Promise<string> {
  const [row] = await db.select({ name: schemes.name }).from(schemes).where(eq(schemes.code, code as never)).limit(1);
  return row?.name ?? SCHEMES.find((s) => s.code === code)?.name ?? code;
}

export async function getUserName(db: Db, userId: string): Promise<string> {
  const [row] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.name ?? '';
}

/** Stable JSON (sorted keys) so the snapshot hash does not depend on key order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`;
}

export const sha256Hex = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

/** Calendar year in Europe/London (report numbers are per year). */
export function londonYear(d: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric' }).format(d));
}
