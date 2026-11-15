import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { jobs } from '../schema.js';

export type Job = typeof jobs.$inferSelect;

/** Known job kinds (text column, so new kinds need no migration). */
export type JobKind = 'render_pdf' | (string & {});

/** Queue a job. Returns its row. */
export async function enqueueJob(db: Db, kind: JobKind, payload: unknown, opts: { runAfter?: Date } = {}): Promise<Job> {
  const [row] = await db
    .insert(jobs)
    .values({ kind, payload: payload ?? {}, ...(opts.runAfter ? { runAfter: opts.runAfter } : {}) })
    .returning();
  return row!;
}

/**
 * Claim the oldest due queued job (optionally of the given kinds): marks it running, bumps
 * attempts and sets locked_at in one statement using FOR UPDATE SKIP LOCKED, so concurrent
 * workers never claim the same job. Returns null when nothing is due.
 */
export async function claimNextJob(db: Db, opts: { kinds?: JobKind[] } = {}): Promise<Job | null> {
  const conds = [eq(jobs.status, 'queued'), lte(jobs.runAfter, sql`now()`)];
  if (opts.kinds?.length) conds.push(inArray(jobs.kind, opts.kinds));
  const next = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(...conds))
    .orderBy(asc(jobs.runAfter), asc(jobs.id))
    .limit(1)
    .for('update', { skipLocked: true });
  const [row] = await db
    .update(jobs)
    .set({ status: 'running', attempts: sql`${jobs.attempts} + 1`, lockedAt: sql`now()` })
    .where(and(inArray(jobs.id, next), eq(jobs.status, 'queued')))
    .returning();
  return row ?? null;
}

/** Mark a job done. */
export async function completeJob(db: Db, id: number): Promise<void> {
  await db.update(jobs).set({ status: 'done', lastError: null, lockedAt: null }).where(eq(jobs.id, id));
}

/**
 * Record a failure. If attempts < maxAttempts the job is re-queued with exponential backoff
 * (retryDelaySeconds, default 30s·2^(attempts-1)); otherwise it is marked failed.
 * Returns the resulting status.
 */
export async function failJob(
  db: Db,
  id: number,
  error: unknown,
  opts: { maxAttempts?: number; retryDelaySeconds?: number } = {},
): Promise<'queued' | 'failed'> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const message = (error instanceof Error ? (error.stack ?? error.message) : String(error)).slice(0, 4000);
  const delay = opts.retryDelaySeconds !== undefined
    ? sql`${opts.retryDelaySeconds}::double precision`
    : sql`30 * power(2, greatest(${jobs.attempts} - 1, 0))`;
  const [row] = await db
    .update(jobs)
    .set({
      status: sql`case when ${jobs.attempts} >= ${maxAttempts} then 'failed' else 'queued' end`,
      runAfter: sql`case when ${jobs.attempts} >= ${maxAttempts} then ${jobs.runAfter} else now() + (${delay}) * interval '1 second' end`,
      lastError: message,
      lockedAt: null,
    })
    .where(eq(jobs.id, id))
    .returning({ status: jobs.status });
  if (!row) throw new Error(`job ${id} not found`);
  return row.status as 'queued' | 'failed';
}

/** Re-queue jobs stuck in 'running' longer than `olderThanSeconds` (e.g. a worker crashed). Returns the count. */
export async function requeueStuckJobs(db: Db, olderThanSeconds = 600): Promise<number> {
  const rows = await db
    .update(jobs)
    .set({ status: 'queued', lockedAt: null })
    .where(and(eq(jobs.status, 'running'), lte(jobs.lockedAt, sql`now() - ${olderThanSeconds} * interval '1 second'`)))
    .returning({ id: jobs.id });
  return rows.length;
}
