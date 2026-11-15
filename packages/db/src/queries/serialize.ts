/** Row → API shape helpers: Date → ISO-8601 string (zod `z.iso.datetime({ offset: true })`). */
export type Serialized<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K] };

export const toIso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** Shallow-convert every Date field of a row to an ISO string. */
export function serializeRow<T extends Record<string, unknown>>(row: T): Serialized<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
  return out as Serialized<T>;
}
