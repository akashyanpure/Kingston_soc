import { describe, expect, it } from 'vitest';
import { buildFormDefinition } from '@soc/shared';
import { renderReportHtml, reportPhotos, sampleBundle } from './index.js';
import type { ReportInput } from './index.js';

const form = buildFormDefinition();
const base = (over: Partial<ReportInput> = {}): ReportInput => ({
  bundle: sampleBundle(form), form, schemeName: 'Private Leasing Scheme', officerName: 'P. Dekaate', mode: 'draft',
  photoSrc: (id) => `/api/photos/${id}/file`, ...over,
});

describe('renderReportHtml', () => {
  it('renders a complete document with the template sections in order', () => {
    const html = renderReportHtml(base());
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    const order = [
      "Kingston Council&#39;s Private Leasing Scheme", 'SCHEDULE OF CONDITION and Inventory', 'Safety Disclaimer',
      'DESCRIPTION OF PROPERTY', 'KEYS HELD', 'MAKE', 'SERIAL', 'READING IN', 'Condition key', 'Unacceptable',
      'FRONT DOOR', 'KITCHEN', 'MISCELLANEOUS', 'Photographic evidence', 'Additional notes', 'DECLARATION',
    ];
    let at = 0;
    for (const s of order) {
      const i = html.indexOf(s, at);
      expect(i, `"${s}" after position ${at}`).toBeGreaterThan(-1);
      at = i;
    }
    expect(html).toContain('SCHEDULE OF DILAPIDATION');
    expect(html).toContain('PHOTO');
    expect(html).toContain('PROPERTY:');
    expect(html).toContain('ABBREVIATION: WP-White Plastic');
    expect(html).toContain('PLS Agreements/PLS/Schedule of Condition Pro Forma');
    expect(html).toContain('counter(pages)');
    expect(html).toContain('15 September 2026, 09:34–10:12');
    expect(html).toContain('Boilers, gas fires, water supply and radiators are not tested.');
    expect(html).toContain('When additions are made the landlord/agent and the Council MUST agree and initial.');
    expect(html).toContain('DRAFT — not issued');
  });

  it('is deterministic', () => {
    expect(renderReportHtml(base())).toBe(renderReportHtml(base()));
  });

  it('omits rooms that are not present', () => {
    const html = renderReportHtml(base());
    expect(html).toContain('class="room-name">KITCHEN<');
    expect(html).not.toContain('class="room-name">CONSERVATORY<');
    expect(html).not.toContain('class="room-name">BEDROOM 4<');
  });

  it('assigns provisional photo refs by capture time and shows them in item rows', () => {
    const b = sampleBundle(form);
    const photos = reportPhotos(b);
    expect(photos).toHaveLength(7);
    const html = renderReportHtml(base({ bundle: b }));
    expect(html).toContain('P-6');
    expect(html).toContain('P-7 · MISCELLANEOUS · GARDEN TABLE');
    expect(html).toContain('N/A: Not accessible');
  });

  it('escapes user text', () => {
    const b = sampleBundle(form);
    b.items[0]!.comment = '<script>alert(1)</script>';
    b.property.addressLine1 = '1 "Evil" <b>Road</b>';
    b.notes[0]!.note = '<img src=x onerror=alert(1)>';
    const html = renderReportHtml(base({ bundle: b, officerName: '<i>x</i>' }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>Road</b>');
    expect(html).not.toContain('<i>x</i>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    // CSS string in @page margin box is escaped too
    expect(html).toContain(String.raw`1 \"EVIL\" \3C B\3E ROAD`);
  });

  it('rejects unsafe photo URLs', () => {
    const html = renderReportHtml(base({ photoSrc: () => 'javascript:alert(1)' }));
    expect(html).not.toContain('javascript:');
  });

  it('shows only the tenant signature block that fits the visit type', () => {
    const checkIn = renderReportHtml(base());
    expect(checkIn).toContain('Tenant (at check-in)');
    expect(checkIn).not.toContain('Tenant (at check-out)');
    const b = sampleBundle(form);
    b.visit.visitType = 'check_out';
    const checkOut = renderReportHtml(base({ bundle: b }));
    expect(checkOut).toContain('Tenant (at check-out)');
    expect(checkOut).not.toContain('Tenant (at check-in)');
    const interim = sampleBundle(form);
    interim.visit.visitType = 'interim';
    expect(renderReportHtml(base({ bundle: interim }))).not.toMatch(/Tenant \(at check-(in|out)\)/);
  });

  it('puts the scheme name in the cover and declaration', () => {
    const html = renderReportHtml(base({ schemeName: 'Tenant Finder' }));
    expect(html).toContain('Kingston Council&#39;s Tenant Finder');
    expect(html).toContain('accuracy cannot be guaranteed by the Tenant Finder.');
    expect(html).not.toContain('{scheme}');
  });

  it('final mode: no watermark, prints report number, content hash and the e-signatures', async () => {
    const b = sampleBundle(form);
    b.visit.reportNumber = 'SOC-2026-0417';
    b.visit.status = 'issued';
    const sig = b.signatures[0]!;
    b.signatures.push({ ...sig, id: '0190a000-0000-7000-8000-000000000091', role: 'landlord_agent', name: '<b>A. Pemberton</b>', hasImage: false });
    b.signatures.push({ ...sig, id: '0190a000-0000-7000-8000-000000000092', role: 'tenant_check_in', name: 'Link Person', method: 'link' });
    const html = renderReportHtml(base({
      bundle: b, mode: 'final', sha256: 'ab'.repeat(32), issuedAt: '2026-09-15T10:20:00+01:00',
      signatureSrc: (id) => (id === sig.id ? 'data:image/png;base64,iVBORw0KGgo=' : null),
    }));
    expect(html).not.toContain('class="watermark"');
    expect(html).toContain('SOC-2026-0417');
    expect(html).toContain('SHA-256');
    expect(html).toContain('abab abab');
    expect(html).toContain('<img src="data:image/png;base64,iVBORw0KGgo=" alt="Signature of P. Dekaate">');
    expect(html).toContain('PRINT NAME: <b>P. Dekaate</b>');
    expect(html).toContain('15/09/2026 10:14 · Signed electronically on device');
    expect(html).toContain('signed on behalf of the landlord:');
    expect(html).toContain('&lt;b&gt;A. Pemberton&lt;/b&gt;');
    expect(html).not.toContain('Link Person'); // post-issue link signatures are not printed
    expect(html).toContain('Not signed');
    expect(html).not.toContain('______');
    expect(html).toContain('Issued 15/09/2026 10:20');
  });
});
