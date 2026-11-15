/**
 * Real Chromium render of the sample report. Slow (launches a browser), so opt-in:
 *   SOC_PDF_TEST=1 pnpm --filter @soc/api test
 * Writes the PDF to data/test-output/sample-report.pdf for a visual check.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFormDefinition } from '@soc/shared';
import { renderReportHtml, sampleBundle } from '@soc/report';
import { REPO_ROOT } from '../src/config.js';
import { ChromiumPdfRenderer } from '../src/pdf/renderer.js';

// 1×1 grey JPEG
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

describe.runIf(process.env.SOC_PDF_TEST === '1')('Chromium PDF', () => {
  it('renders the sample report to a multi-page A4 PDF', async () => {
    const form = buildFormDefinition();
    const bundle = sampleBundle(form);
    bundle.visit.reportNumber = 'SOC-2026-0417';
    const html = renderReportHtml({
      bundle, form, schemeName: 'Private Leasing Scheme', officerName: 'P. Dekaate', mode: 'final', sha256: 'ab'.repeat(32), photoSrc: () => JPEG,
    });
    const r = new ChromiumPdfRenderer();
    try {
      const pdf = await r.render(html);
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
      expect(pages).toBeGreaterThan(5);
      const out = resolve(REPO_ROOT, 'data/test-output');
      await mkdir(out, { recursive: true });
      await writeFile(resolve(out, 'sample-report.pdf'), pdf);
      await writeFile(resolve(out, 'sample-report.html'), html);
    } finally {
      await r.close();
    }
  }, 120_000);
});

describe.runIf(process.env.SOC_PDF_TEST === '1')('issue → Chromium PDF (end to end)', () => {
  it('issues a visit, renders the real PDF, stores it and emails the landlord', async () => {
    const { createHash } = await import('node:crypto');
    const { setup, login, createVisit, completeVisit } = await import('./helpers.js');
    const { processNextJob } = await import('../src/pdf/worker.js');
    const jpegBytes = Buffer.from(JPEG.split(',')[1]!, 'base64');
    const jpeg = () => ({ bytes: jpegBytes, sha256: createHash('sha256').update(jpegBytes).digest('hex') });
    const t = await setup({}, new ChromiumPdfRenderer());
    try {
      const cookie = await login(t, 'officer');
      const b = await createVisit(t, cookie, ['FRONT_DOOR', 'KITCHEN']);
      await completeVisit(t, cookie, b, jpeg);
      const issued = await t.app.inject({ method: 'POST', url: `/api/visits/${b.visit.id}/issue`, headers: { cookie } });
      expect(issued.statusCode).toBe(201);
      const { report } = issued.json();
      expect(await processNextJob(t.app.ctx)).toBe(true);
      const pdf = await t.app.inject({ method: 'GET', url: `/api/reports/${report.id}/pdf`, headers: { cookie } });
      expect(pdf.statusCode).toBe(200);
      expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
      const meta = (await t.app.inject({ method: 'GET', url: `/api/reports/${report.id}`, headers: { cookie } })).json();
      expect(meta.report.sha256).toBe(createHash('sha256').update(pdf.rawPayload).digest('hex'));
      expect(t.mail.sent).toHaveLength(1);
      expect(t.mail.sent[0]!.attachments?.[0]?.contentType).toBe('application/pdf');
      const out = resolve(REPO_ROOT, 'data/test-output');
      await mkdir(out, { recursive: true });
      await writeFile(resolve(out, `${report.reportNumber}.pdf`), pdf.rawPayload);
    } finally {
      await t.close();
    }
  }, 180_000);
});
