/**
 * POST /visits/:id/issue — one transaction, in the order the immutability triggers require:
 *   lock visit → bundle → visitContentHash → issueBlockers (+ PHOTO_NOT_UPLOADED) (409) →
 *   allocateReportNumber → photo refs P-1…P-n by capturedAt → snapshot → INSERT report →
 *   link on-device signatures (report_id) → visit status 'issued' LAST → render_pdf job.
 * The snapshot (bundle + form definition + scheme + officer + content hash + issue time) is what the
 * PDF is rendered from, so the issued document never changes even if reference data does.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { allocateReportNumber, enqueueJob, loadVisitBundle, photos, reports, signatures, visits } from '@soc/db';
import type { Db } from '@soc/db';
import { reportPhotos } from '@soc/report';
import type { ReportSnapshot } from '@soc/report';
import { Report, issueBlockers, visitContentHash } from '@soc/shared';
import type { Blocker, User, VisitBundle } from '@soc/shared';
import { HttpError, conflict } from '../errors.js';
import { getFormDefinition, getSchemeName, getUserName, getVisitForUser, londonYear } from './visits.js';

/** Stored in reports.snapshot. `contentSha256` = visitContentHash(bundle) — what the signers signed. */
export interface StoredSnapshot extends ReportSnapshot {
  contentSha256: string;
  issuedAt?: string;
}

/**
 * Shared issue rules (content + signatures) plus the server-only PHOTO_NOT_UPLOADED check
 * (after issue the photos table is immutable, so a late upload could never be recorded).
 */
export function serverIssueBlockers(bundle: VisitBundle, contentSha256 = visitContentHash(bundle)): Blocker[] {
  const out: Blocker[] = [];
  for (const p of bundle.photos) {
    if (p.deletedAt || p.uploaded) continue;
    out.push({
      code: 'PHOTO_NOT_UPLOADED', message: `Photo taken ${p.capturedAt} has not finished uploading.`, photoId: p.id,
      ...(p.itemRecordId ? { itemRecordId: p.itemRecordId } : {}), ...(p.roomInstanceId ? { roomInstanceId: p.roomInstanceId } : {}),
    });
  }
  const shared = issueBlockers({
    rooms: bundle.rooms, items: bundle.items, photos: bundle.photos, general: bundle.general,
    signatures: bundle.signatures, visitType: bundle.visit.visitType, contentSha256,
  });
  return [...shared, ...out];
}

export class IssueBlockedError extends HttpError {
  constructor(public readonly blockers: Blocker[]) {
    super(409, 'ISSUE_BLOCKED', `The report cannot be issued yet (${blockers.length} item(s) to resolve).`, { blockers });
  }
}

export async function issueVisit(db: Db, user: User, visitId: string, now = new Date()): Promise<Report> {
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const visit = await getVisitForUser(tx, user, visitId, { forUpdate: true });
    if (visit.status === 'issued') throw conflict('ALREADY_ISSUED', 'This visit has already been issued.');
    if (visit.status === 'cancelled') throw conflict('VISIT_CANCELLED', 'A cancelled visit cannot be issued.');

    const bundle = (await loadVisitBundle(tx, visitId))!;
    const contentSha256 = visitContentHash(bundle);
    const blockers = serverIssueBlockers(bundle, contentSha256);
    if (blockers.length) throw new IssueBlockedError(blockers);

    const reportNumber = await allocateReportNumber(tx, londonYear(now));
    for (const [i, p] of reportPhotos(bundle).entries()) {
      await tx.update(photos).set({ ref: `P-${i + 1}` }).where(eq(photos.id, p.id));
    }

    // Snapshot = the bundle as it will be once issued (refs assigned, status flipped, signatures linked).
    const reportId = uuidv7();
    const completedAt = visit.completedAt ?? now;
    const fresh = (await loadVisitBundle(tx, visitId))!;
    const issuedBundle: VisitBundle = {
      ...fresh,
      visit: { ...fresh.visit, status: 'issued', reportNumber, completedAt: completedAt.toISOString(), updatedAt: now.toISOString(), updatedBy: user.id },
      signatures: fresh.signatures.map((s) => (s.method === 'on_device' ? { ...s, reportId } : s)),
    };
    const base: ReportSnapshot = {
      bundle: issuedBundle,
      form: await getFormDefinition(tx, visit.formVersionId),
      schemeName: await getSchemeName(tx, visit.schemeCode),
      officerName: await getUserName(tx, visit.officerId),
    };
    const snapshot: StoredSnapshot = { ...base, contentSha256, issuedAt: now.toISOString() };
    if (visitContentHash(issuedBundle) !== contentSha256) throw new Error('content hash changed while issuing'); // invariant

    const [row] = await tx
      .insert(reports)
      .values({ id: reportId, visitId, reportNumber, snapshot, issuedAt: now, issuedBy: user.id, pdfReady: false })
      .returning();
    await tx
      .update(signatures)
      .set({ reportId })
      .where(and(eq(signatures.visitId, visitId), eq(signatures.method, 'on_device'), isNull(signatures.deletedAt)));
    // LAST: after this every write to the visit's child tables is rejected by the triggers.
    await tx
      .update(visits)
      .set({ status: 'issued', reportNumber, completedAt, updatedAt: now, updatedBy: user.id })
      .where(eq(visits.id, visitId));
    await enqueueJob(tx, 'render_pdf', { reportId });
    return toReport(row!);
  });
}

export function toReport(r: typeof reports.$inferSelect): Report {
  return Report.parse({
    id: r.id, visitId: r.visitId, reportNumber: r.reportNumber, sha256: r.sha256, pdfReady: r.pdfReady,
    issuedAt: r.issuedAt.toISOString(), issuedBy: r.issuedBy,
  });
}
