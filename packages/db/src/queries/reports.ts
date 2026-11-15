import { sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { reportNumberSeq } from '../schema.js';

/** Format a report number: SOC-YYYY-NNNN (4+ digits). */
export const formatReportNumber = (year: number, n: number) => `SOC-${year}-${String(n).padStart(4, '0')}`;

/**
 * Allocate the next report number for `year` (e.g. "SOC-2026-0001"). The upsert takes a row lock
 * on report_number_seq(year), so concurrent issue transactions serialise and numbers are gap-free
 * per year as long as it runs inside the issue transaction (a rollback releases the number).
 */
export async function allocateReportNumber(tx: Db, year: number): Promise<string> {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new Error(`invalid report year ${year}`);
  const [row] = await tx
    .insert(reportNumberSeq)
    .values({ year, last: 1 })
    .onConflictDoUpdate({ target: reportNumberSeq.year, set: { last: sql`${reportNumberSeq.last} + 1` } })
    .returning({ last: reportNumberSeq.last });
  return formatReportNumber(year, row!.last);
}
