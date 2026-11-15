/** SQLSTATE raised by the immutability triggers (migrations/0001_constraints_triggers.sql). */
export const IMMUTABLE_SQLSTATE = 'SOC01';

function sqlState(err: unknown): string | undefined {
  // drizzle >=0.44 wraps driver errors in DrizzleQueryError (original in `cause`).
  for (let e: unknown = err, depth = 0; e && typeof e === 'object' && depth < 5; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

/** True when `err` was raised by an immutability trigger (issued visit / report). Map to HTTP 409. */
export const isImmutableError = (err: unknown): boolean => sqlState(err) === IMMUTABLE_SQLSTATE;

/** True for a unique-constraint violation (23505). */
export const isUniqueViolation = (err: unknown): boolean => sqlState(err) === '23505';

/** The Postgres SQLSTATE of an error thrown through drizzle (pg or PGlite), if any. */
export const pgErrorCode = sqlState;
