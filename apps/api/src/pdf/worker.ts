/**
 * In-process PDF worker: polls the Postgres jobs queue (claimNextJob, FOR UPDATE SKIP LOCKED),
 * renders the issued snapshot with Chromium, stores the PDF, records its SHA-256 and emails it
 * to the landlord/agent. Failures retry with exponential backoff (failJob) up to 5 attempts.
 * Can be moved to a separate process later: call processNextJob(ctx) in a loop.
 */
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { claimNextJob, completeJob, failJob, reports, requeueStuckJobs } from '@soc/db';
import { renderReportHtml, reportPhotos } from '@soc/report';
import { photoKey, reportPdfKey } from '../adapters/storage.js';
import type { AppContext } from '../context.js';
import type { StoredSnapshot } from '../services/issue.js';
import { sha256Hex } from '../services/visits.js';

export const MAX_ATTEMPTS = 5;

/** Build the final HTML for an issued snapshot with photos inlined as data URIs. */
export async function snapshotHtml(ctx: AppContext, snapshot: StoredSnapshot): Promise<string> {
  const data = new Map<string, string>();
  for (const p of reportPhotos(snapshot.bundle)) {
    const bytes = await ctx.storage.get(photoKey(snapshot.bundle.visit.id, p.id));
    if (!bytes) throw new Error(`photo ${p.id} binary missing from storage`);
    data.set(p.id, `data:image/jpeg;base64,${bytes.toString('base64')}`);
  }
  return renderReportHtml({
    bundle: snapshot.bundle,
    form: snapshot.form,
    schemeName: snapshot.schemeName,
    officerName: snapshot.officerName,
    mode: 'final',
    sha256: snapshot.contentSha256,
    photoSrc: (id) => data.get(id) ?? '',
  });
}

async function renderReport(ctx: AppContext, reportId: string, log?: FastifyBaseLogger): Promise<void> {
  const [report] = await ctx.db.select().from(reports).where(eq(reports.id, reportId)).limit(1);
  if (!report) throw new Error(`report ${reportId} not found`);
  if (report.pdfReady) return;
  const snapshot = report.snapshot as StoredSnapshot;
  const html = await snapshotHtml(ctx, snapshot);
  const pdf = await ctx.pdf.render(html);
  const sha256 = sha256Hex(pdf);
  const key = reportPdfKey(report.visitId, report.reportNumber);
  await ctx.storage.put(key, pdf);
  await ctx.db.update(reports).set({ pdfStorageKey: key, sha256, pdfReady: true }).where(eq(reports.id, reportId));
  log?.info({ reportId, reportNumber: report.reportNumber, bytes: pdf.length }, 'report PDF ready');

  // Email the landlord/agent (and team inbox) — best effort, never fails the job.
  try {
    const { bundle, schemeName } = snapshot;
    const to = [bundle.landlord?.email].filter((e): e is string => !!e);
    const cc = ctx.config.mailTeamInbox ? [ctx.config.mailTeamInbox] : [];
    if (to.length || cc.length) {
      const address = `${bundle.property.addressLine1}, ${bundle.property.postcode}`;
      await ctx.mail.send({
        to: to.length ? to : cc,
        cc: to.length ? cc : [],
        subject: `Schedule of Condition ${report.reportNumber} — ${address}`,
        text: [
          `Dear ${bundle.landlord?.name ?? 'Sir/Madam'},`,
          '',
          `Please find attached the Schedule of Condition and Inventory (${report.reportNumber}) for ${address}, issued under the Royal Borough of Kingston's ${schemeName}.`,
          '',
          'It is your responsibility to check the accuracy of this Schedule of Condition. Any additions must be agreed and initialled by the landlord/agent and the Council.',
          '',
          `Document SHA-256: ${sha256}`,
          '',
          'Private Sector Schemes, Royal Borough of Kingston upon Thames',
        ].join('\n'),
        attachments: [{ filename: `${report.reportNumber}.pdf`, contentType: 'application/pdf', content: pdf }],
      });
    }
  } catch (err) {
    log?.error({ err, reportId }, 'failed to email report');
  }
}

/** Claim and run one job. Returns false when the queue is empty. */
export async function processNextJob(ctx: AppContext, log?: FastifyBaseLogger): Promise<boolean> {
  const job = await claimNextJob(ctx.db, { kinds: ['render_pdf'] });
  if (!job) return false;
  try {
    const { reportId } = job.payload as { reportId: string };
    await renderReport(ctx, reportId, log);
    await completeJob(ctx.db, job.id);
  } catch (err) {
    const status = await failJob(ctx.db, job.id, err, { maxAttempts: MAX_ATTEMPTS });
    log?.error({ err, jobId: job.id, attempt: job.attempts, status }, 'render_pdf failed');
  }
  return true;
}

export class PdfWorker {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopped = true;

  constructor(
    private readonly ctx: AppContext,
    private readonly log?: FastifyBaseLogger,
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    await requeueStuckJobs(this.ctx.db, 600).catch((err) => this.log?.error({ err }, 'requeueStuckJobs failed'));
    this.schedule(0);
  }

  /** Run a poll now (e.g. right after issue). */
  kick(): void {
    if (!this.stopped && !this.running) this.schedule(0);
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  private async tick(): Promise<void> {
    this.timer = null;
    if (this.running || this.stopped) return;
    this.running = (async () => {
      try {
        while (!this.stopped && (await processNextJob(this.ctx, this.log)));
      } catch (err) {
        this.log?.error({ err }, 'pdf worker poll failed');
      }
    })();
    await this.running;
    this.running = null;
    this.schedule(this.ctx.config.pdfPollMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.running;
  }
}
