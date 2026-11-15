/**
 * POST /visits/:id/issue — one transaction:
 *   lock visit → issueBlockers (409) → all report photos uploaded (409) → allocateReportNumber →
 *   photo refs P-1…P-n by capturedAt → visit status 'issued' → snapshot → reports row → render_pdf job.
 * The snapshot (bundle + form definition + scheme + officer + content hash) is what the PDF is
 * rendered from, so the issued document never changes even if reference data does.
 */
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { allocateReportNumber, enqueueJob, loadVisitBundle, photos, reports, visits } from '@soc/db';
import type { Db } from '@soc/db';
import { reportPhotos } from '@soc/report';
import type { ReportSnapshot } from '@soc/report';
import { Report, issueBlockers } from '@soc/shared';
import type { Blocker, User, VisitBundle } from '@soc/shared';
import { HttpError, conflict } from '../errors.js';
import { canonicalJson, getFormDefinition, getSchemeName, getUserName, getVisitForUser, londonYear, sha256Hex } from './visits.js';

/** Stored in reports.snapshot. `contentSha256` = SHA-256 of the canonical JSON of the other fields. */
export interface StoredSnapshot extends ReportSnapshot {
  contentSha256: string;
}

export type ServerBlocker = Omit<Blocker, 'code'> & { code: Blocker['code'] | 'PHOTO_NOT_UPLOADED'; photoId?: string };

/**
 * Shared issue rules + a server-only rule: every live photo must have its binary uploaded
 * (after issue the photos table is immutable, so a late upload could never be recorded).
 * Proposed for packages/shared/src/rules.ts as BlockerCode 'PHOTO_NOT_UPLOADED'.
 */
export function serverIssueBlockers(bundle: VisitBundle): ServerBlocker[] {
  const out: ServerBlocker[] = [...issueBlockers(bundle)];
  for (const p of bundle.photos) {
    if (p.deletedAt || p.uploaded) continue;
    out.push({ code: 'PHOTO_NOT_UPLOADED', message: `Photo taken ${p.capturedAt} has not finished uploading.`, photoId: p.id, ...(p.itemRecordId ? { itemRecordId: p.itemRecordId } : {}), ...(p.roomInstanceId ? { roomInstanceId: p.roomInstanceId } : {}) });
  }
  return out;
}

export class IssueBlockedError extends HttpError {
  constructor(public readonly blockers: unknown[]) {
    super(409, 'ISSUE_BLOCKED', `The report cannot be issued yet (${blockers.length} item(s) to resolve).`, { blockers });
  }
}

export async function issueVisit(db: Db, user: User, visitId: string, now = new Date()): Promise<Report> {
  return db.transaction(async (tx) => {
    const visit = await getVisitForUser(tx as unknown as Db, user, visitId, { forUpdate: true });
    if (visit.status === 'issued') throw conflict('ALREADY_ISSUED', 'This visit has already been issued.');
    if (visit.status === 'cancelled') throw conflict('VISIT_CANCELLED', 'A cancelled visit cannot be issued.');

    const t = tx as unknown as Db;
    const bundle = (await loadVisitBundle(t, visitId))!;
    const blockers = serverIssueBlockers(bundle);
    if (blockers.length) throw new IssueBlockedError(blockers);

    const inReport = reportPhotos(bundle);

    const reportNumber = await allocateReportNumber(t, londonYear(now));
    for (const [i, p] of inReport.entries()) {
      await t.update(photos).set({ ref: `P-${i + 1}` }).where(eq(photos.id, p.id));
    }
    await t
      .update(visits)
      .set({ status: 'issued', reportNumber, completedAt: visit.completedAt ?? now, updatedAt: now, updatedBy: user.id })
      .where(eq(visits.id, visitId));

    const issuedBundle = (await loadVisitBundle(t, visitId))!;
    const base: ReportSnapshot = {
      bundle: issuedBundle,
      form: await getFormDefinition(t, visit.formVersionId),
      schemeName: await getSchemeName(t, visit.schemeCode),
      officerName: await getUserName(t, visit.officerId),
    };
    const snapshot: StoredSnapshot = { ...base, contentSha256: sha256Hex(canonicalJson(base)) };

    const [row] = await t
      .insert(reports)
      .values({ id: uuidv7(), visitId, reportNumber, snapshot, issuedAt: now, issuedBy: user.id, pdfReady: false })
      .returning();
    await enqueueJob(t, 'render_pdf', { reportId: row!.id });
    return toReport(row!);
  });
}

export function toReport(r: typeof reports.$inferSelect): Report {
  return Report.parse({
    id: r.id, visitId: r.visitId, reportNumber: r.reportNumber, sha256: r.sha256, pdfReady: r.pdfReady,
    issuedAt: r.issuedAt.toISOString(), issuedBy: r.issuedBy,
  });
}
