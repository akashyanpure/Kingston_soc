/**
 * Schedule of Condition report renderer: VisitBundle + FormDefinition → standalone HTML.
 *
 * Pure TypeScript, no Node APIs: the web app calls this to show an offline draft and the
 * API renders the same HTML to PDF with Chromium. Same input → same output (no clocks,
 * no randomness). Every piece of user text goes through esc().
 *
 * Section order follows SOC TEMPLATE (PLS).docx (see soc-template-form / soc-report-generation):
 * cover · safety disclaimer · schedule of condition (general) · kitchen appliances · meter readings ·
 * condition key · room tables (present rooms only) · miscellaneous · photo appendix ·
 * additional notes · declaration + signatures.
 */
import { DEFECT_CONDITIONS, withScheme } from '@soc/shared';
import type { FormDefinition, ItemRecord, Signature, SignatureRole, VisitBundle } from '@soc/shared';
import { cssString, dateTime, esc, groupHash, inspectionWindow, longDate, safeSrc, shortDate } from './format.js';
import { photoRefMap, reportPhotos } from './photos.js';
import { REPORT_CSS } from './styles.js';

export interface ReportInput {
  bundle: VisitBundle;
  form: FormDefinition;
  /** Scheme display name, e.g. "Private Leasing Scheme" (decision 6). */
  schemeName: string;
  officerName: string;
  mode: 'draft' | 'final';
  /** URL / data URI for a photo's image. */
  photoSrc: (photoId: string) => string;
  /** URL / data URI for a signature image, or null when there is none. */
  signatureSrc?: (signatureId: string) => string | null;
  /** SHA-256 printed on the declaration page in final mode (hash of the issued record snapshot). */
  sha256?: string | null;
}

const VISIT_TYPE_LABEL: Record<string, string> = { check_in: 'CHECK-IN', check_out: 'CHECK-OUT', interim: 'INTERIM' };
const METHOD_LABEL: Record<string, string> = {
  on_device: 'Signed on device',
  link: 'Signed via link',
  wet: 'Wet signature',
  officer_only: 'Recorded by officer',
};
const UNSIGNED_HINT: Record<SignatureRole, string> = {
  landlord_agent: 'signed on behalf of the landlord:',
  officer: 'signed on behalf of the Council:',
  tenant_check_in: 'signed by the tenant at check-in:',
  tenant_check_out: 'signed by the tenant at check-out:',
};

const bySort = <T extends { sortOrder: number; id: string }>(a: T, b: T) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const isDefect = (c: ItemRecord['condition']) => !!c && DEFECT_CONDITIONS.includes(c);
const dash = (v: string | null | undefined) => (v && v.trim() ? esc(v) : '<span class="nil">—</span>');
const multiline = (v: string | null | undefined) => (v && v.trim() ? esc(v).replace(/\r?\n/g, '<br>') : '<span class="nil">—</span>');

export function renderReportHtml(input: ReportInput): string {
  const { bundle, form, schemeName, officerName, mode } = input;
  const { visit, property, landlord, tenancy } = bundle;
  const final = mode === 'final';

  const address = [property.addressLine1, property.addressLine2, property.town].filter((s) => s && s.trim()).join(', ');
  const addressLine = `${address} ${property.postcode}`.trim();
  const inspectionStart = visit.startedAt ?? visit.scheduledAt ?? null;
  const inspectionDate = inspectionWindow(inspectionStart, visit.completedAt);
  const reportNumber = visit.reportNumber ?? bundle.report?.reportNumber ?? null;
  const refLabel = reportNumber ?? 'DRAFT';
  const visitTypeLabel = VISIT_TYPE_LABEL[visit.visitType] ?? visit.visitType.toUpperCase();

  const presentRooms = bundle.rooms.filter((r) => r.present).sort(bySort);
  const presentIds = new Set(presentRooms.map((r) => r.id));
  const roomItems = (roomId: string) => bundle.items.filter((i) => i.roomInstanceId === roomId).sort(bySort);
  const miscItems = bundle.items.filter((i) => i.roomInstanceId === null).sort(bySort);
  const reportItems = bundle.items.filter((i) => i.roomInstanceId === null || presentIds.has(i.roomInstanceId));
  const photos = reportPhotos(bundle);
  const refs = photoRefMap(bundle);
  const photosForItem = (itemId: string) => photos.filter((p) => p.itemRecordId === itemId).map((p) => refs.get(p.id)!);
  const photoRef = (id: string | null) => (id ? refs.get(id) ?? null : null);
  const belowGood = reportItems.filter((i) => isDefect(i.condition)).length;

  const label = (code: string, fallback: string, list: { code: string; label: string }[]) => list.find((x) => x.code === code)?.label ?? fallback;
  const landlordText = landlord ? [landlord.name, landlord.company].filter(Boolean).join(', ') : '';

  // ── Cover ────────────────────────────────────────────────────────────────
  const coverField = (k: string, v: string) => `<div class="cover-field"><div class="k">${esc(k)}</div><div class="v">${v ? esc(v) : '<span class="nil">—</span>'}</div></div>`;
  const cover = `
<section class="cover">
  <div class="cover-top">
    <div class="brand">
      <div class="brand-name">ROYAL BOROUGH OF KINGSTON<br>UPON THAMES</div>
      <div class="brand-sub">Housing · Private Sector Schemes</div>
    </div>
    <div class="cover-ref mono">${esc(refLabel)}<br>${esc(visit.schemeCode)} · ${esc(visitTypeLabel)}</div>
  </div>
  <div class="cover-main">
    <div class="cover-prefix">${esc(withScheme(form.coverPrefix, schemeName))}</div>
    <h1 class="cover-title">${esc(form.coverTitle)}</h1>
    <div class="rule-accent"></div>
    <div class="cover-at"><span class="k">At</span> ${esc(address)}<br>${esc(property.postcode)}</div>
    <div class="cover-grid">
      ${coverField('Date', inspectionDate)}
      ${coverField('Property type', property.propertyType)}
      ${coverField('Landlord/Agent', landlordText)}
      ${coverField('Tenant', tenancy?.tenantName ?? '')}
      ${coverField('Private Sector Schemes Officer', officerName)}
      ${coverField('Report number', reportNumber ?? 'Draft — allocated when issued')}
      ${coverField('Record', `${reportItems.length} items · ${photos.length} photographs · ${belowGood} below good`)}
    </div>
  </div>
  <div class="cover-foot">
    <span class="mono">${esc(form.boilerplate.website)}</span>
    <span class="mono">Generated automatically from the inventory app</span>
  </div>
</section>`;

  // ── Safety disclaimer ────────────────────────────────────────────────────
  const disclaimer = `
<section class="block disclaimer">
  <h2>${esc(form.boilerplate.disclaimerTitle)}</h2>
  ${form.boilerplate.disclaimer.map((p) => `<p>${esc(p)}</p>`).join('\n  ')}
</section>`;

  // ── Schedule of condition (general) ──────────────────────────────────────
  const generalRows = form.general
    .map((f) => {
      const v = bundle.general.find((g) => g.fieldCode === f.code)?.value;
      return `<tr><th scope="row">${esc(f.label)}</th><td>${multiline(v ?? '')}</td></tr>`;
    })
    .join('');
  const applianceRows = form.appliances
    .map((a) => {
      const r = bundle.appliances.find((x) => x.applianceCode === a.code);
      return `<tr><th scope="row">${esc(a.label)}</th><td>${dash(r?.make)}</td><td>${dash(r?.model)}</td><td class="mono">${dash(r?.serial)}</td></tr>`;
    })
    .join('');
  const meterRows = form.meters
    .map((m) => {
      const r = bundle.meters.find((x) => x.service === m.code);
      const ref = photoRef(r?.photoId ?? null);
      return `<tr><th scope="row">${esc(m.label)}</th><td>${dash(r?.location)}${ref ? ` <span class="ref">${esc(ref)}</span>` : ''}</td><td class="mono">${dash(r?.readingIn)}</td><td class="mono">${dash(r?.readingOut)}</td></tr>`;
    })
    .join('');
  const general = `
<section class="block">
  <h2>Schedule of Condition</h2>
  <table class="kv"><tbody>${generalRows}</tbody></table>
  <h3>Kitchen appliances: ${esc(form.appliances.map((a) => a.label).join(', '))}</h3>
  <table class="grid">
    <thead><tr><th>Appliance</th>${form.applianceColumns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${applianceRows}</tbody>
  </table>
  <h3>Meter readings</h3>
  <table class="grid">
    <thead><tr>${form.meterColumns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${meterRows}</tbody>
  </table>
  <p class="small muted">Readings in/out: Council/landlord to complete.</p>
</section>`;

  // ── Condition key ────────────────────────────────────────────────────────
  const conditionKey = `
<section class="block key">
  <h3>Condition key</h3>
  <dl>${form.conditionOptions
    .map((c) => `<div><dt>${pill(c.code, c.short)}</dt><dd><strong>${esc(c.label)}</strong> — ${esc(c.definition)}</dd></div>`)
    .join('')}</dl>
  <p class="small">Every item graded ${form.conditionOptions.filter((c) => c.requiresPhoto).map((c) => esc(c.short)).join(', ').replace(/, ([^,]*)$/, ' or $1')} carries a comment and at least one dated photograph in the appendix. Items graded N/A record the reason.</p>
</section>`;

  // ── Room tables ──────────────────────────────────────────────────────────
  const cols = form.itemColumns;
  const itemHead = (title: string, meta: string) => `
    <thead>
      <tr class="running"><th colspan="${cols.length}">
        <div class="run-head"><span><b>PROPERTY:</b> ${esc(addressLine)}</span><span><b>DATE:</b> ${esc(shortDate(inspectionStart))}</span></div>
        <div class="abbr">${esc(form.boilerplate.abbreviations)}</div>
      </th></tr>
      <tr class="room-title"><th colspan="${cols.length}"><span class="room-name">${esc(title)}</span><span class="room-meta">${esc(meta)}</span></th></tr>
      <tr class="cols">${cols.map((c, i) => `<th class="c${i}">${esc(c)}</th>`).join('')}</tr>
    </thead>`;
  const itemRow = (i: ItemRecord) => {
    const refsHere = photosForItem(i.id);
    const comment = i.condition === 'NA' && i.naReason?.trim()
      ? `<span class="na-reason">N/A: ${esc(i.naReason)}</span>${i.comment?.trim() ? `<br>${esc(i.comment)}` : ''}`
      : multiline(i.comment);
    return `<tr>
      <td class="c0 item">${esc(i.label)}</td>
      <td class="c1">${i.qty ?? '<span class="nil">—</span>'}</td>
      <td class="c2">${multiline(i.description)}</td>
      <td class="c3">${i.condition ? pill(i.condition, i.condition === 'NA' ? 'N/A' : i.condition) : '<span class="nil">—</span>'}</td>
      <td class="c4">${comment}</td>
      <td class="c5">${multiline(i.dilapidation)}</td>
      <td class="c6 ref">${refsHere.length ? esc(refsHere.join(', ')) : '<span class="nil">—</span>'}</td>
    </tr>`;
  };
  const roomTable = (title: string, items: ItemRecord[], extraMeta = '', emptyText = 'No items recorded.') => {
    const below = items.filter((i) => isDefect(i.condition)).length;
    const nPhotos = items.reduce((n, i) => n + photosForItem(i.id).length, 0);
    const meta = `${items.length} items · ${below} below good · ${nPhotos} photographs${extraMeta}`;
    const body = items.length ? items.map(itemRow).join('') : `<tr><td colspan="${cols.length}" class="empty">${esc(emptyText)}</td></tr>`;
    return `<table class="items">${cols.length === 7 ? ITEM_COLGROUP : ''}${itemHead(title, meta)}<tbody>${body}</tbody></table>`;
  };
  const rooms = presentRooms
    .map((r) => {
      const wide = photoRef(r.widePhotoId);
      return `<section class="room">${roomTable(r.label, roomItems(r.id), wide ? ` · room photo ${wide}` : '')}</section>`;
    })
    .join('\n');
  const misc = `<section class="room">${roomTable(form.miscellaneous.label, miscItems, '', 'No miscellaneous items recorded.')}</section>`;
  const recorded = `<p class="small muted recorded">Recorded on site ${esc(shortDate(inspectionStart))} by ${esc(officerName)}. Descriptions drawn from the council's standard description library; free-text comments are the officer's own.</p>`;

  // ── Photo appendix (2 per page) ──────────────────────────────────────────
  const roomById = new Map(bundle.rooms.map((r) => [r.id, r]));
  const itemById = new Map(bundle.items.map((i) => [i.id, i]));
  const figure = (p: (typeof photos)[number]) => {
    const item = p.itemRecordId ? itemById.get(p.itemRecordId) : undefined;
    const roomId = item ? item.roomInstanceId : p.roomInstanceId;
    const room = roomId ? roomById.get(roomId)?.label : item ? form.miscellaneous.label : null;
    const meter = bundle.meters.find((m) => m.photoId === p.id);
    const isWide = bundle.rooms.some((r) => r.widePhotoId === p.id);
    const what = [room, item?.label ?? (meter ? `${meter.service} meter` : isWide ? 'Room (wide)' : null)].filter(Boolean).join(' · ');
    const src = safeSrc(input.photoSrc(p.id));
    return `<figure class="photo">
      <div class="frame">${src ? `<img src="${src}" alt="${esc(`${refs.get(p.id)} ${what}`)}">` : '<div class="noimg">Image not available</div>'}</div>
      <figcaption><strong>${esc(refs.get(p.id))} · ${esc(what || 'General')}</strong><span class="when mono">${esc(dateTime(p.capturedAt))}</span>
      <pre class="stamp">${esc(p.stampText)}</pre></figcaption>
    </figure>`;
  };
  const pairs: string[] = [];
  for (let i = 0; i < photos.length; i += 2) pairs.push(`<div class="photo-page">${photos.slice(i, i + 2).map(figure).join('')}</div>`);
  const appendix = `
<section class="appendix">
  <h2>Photographic evidence</h2>
  <p class="small">Each photograph is stamped at capture with the address, date, time, GPS position, the item it evidences and the report number. ${photos.length} photographs.</p>
  ${pairs.length ? pairs.join('\n') : '<p class="muted">No photographs recorded.</p>'}
</section>`;

  // ── Additional notes ─────────────────────────────────────────────────────
  const notes = [...bundle.notes].sort((a, b) => (a.noteDate < b.noteDate ? -1 : a.noteDate > b.noteDate ? 1 : a.id < b.id ? -1 : 1));
  const noteRows = notes.length
    ? notes.map((n) => `<tr><td class="mono">${esc(shortDate(n.noteDate))}</td><td>${multiline(n.note)}</td><td>${esc(n.addedBy)}</td><td class="mono">${dash(n.signed)}</td></tr>`).join('')
    : `<tr><td colspan="4" class="empty">No additional notes.</td></tr>`;
  const additional = `
<section class="block notes">
  <h2>Additional notes</h2>
  <table class="grid">
    <thead><tr>${form.additionalNotes.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${noteRows}</tbody>
  </table>
  <p class="small">${esc(form.additionalNotes.rule)}</p>
</section>`;

  // ── Declaration + signatures ─────────────────────────────────────────────
  const sigFor = (role: SignatureRole): Signature | undefined => bundle.signatures.find((s) => s.role === role);
  const sigBlock = (role: SignatureRole, roleLabel: string) => {
    const s = sigFor(role);
    const img = s && input.signatureSrc ? safeSrc(input.signatureSrc(s.id)) : '';
    return `<div class="sig">
      <div class="k">${esc(roleLabel)}</div>
      <div class="sig-box">${img ? `<img src="${img}" alt="Signature of ${esc(s!.name)}">` : s ? `<span class="sig-name">${esc(s.name)}</span>` : `<span class="hint">${esc(UNSIGNED_HINT[role])}</span>`}</div>
      <div class="sig-meta">${s
        ? `PRINT NAME: <b>${esc(s.name)}</b><br>${esc(METHOD_LABEL[s.method] ?? s.method)} · ${esc(dateTime(s.signedAt))}`
        : 'PRINT NAME: ______________________<br>date: ______________'}</div>
    </div>`;
  };
  const sha = final && input.sha256 ? input.sha256 : null;
  const declaration = `
<section class="block declaration">
  <h2>${esc(form.boilerplate.declarationTitle)}</h2>
  ${form.boilerplate.declaration.map((p) => `<p>${esc(withScheme(p, schemeName))}</p>`).join('\n  ')}
  <div class="sigs">${form.signatureRoles.map((r) => sigBlock(r.role, r.label)).join('')}</div>
  <div class="integrity">
    <div class="small muted">${final ? `Issued ${esc(dateTime(bundle.report?.issuedAt ?? visit.completedAt))}. This record is immutable once issued; corrections are made only by additional notes agreed by both parties.` : 'Draft — this document has not been issued and is not a record of the Council.'}</div>
    ${sha ? `<div class="hash mono">SHA-256<br>${esc(groupHash(sha))}</div>` : ''}
  </div>
</section>`;

  // Page furniture: address + report number on every page (margin boxes); the template's
  // PROPERTY/DATE header + abbreviation key repeats via each item table's <thead>.
  const runningLeft = addressLine.toUpperCase();
  const runningRight = `${refLabel} · ${visit.schemeCode} · ${visitTypeLabel}`;
  const footerLeft = form.boilerplate.footerReference;
  const pageCss = `
@page {
  size: A4;
  margin: 16mm 12mm 16mm 12mm;
  @top-left { content: ${cssString(runningLeft)}; font: 7.5pt ui-monospace, Menlo, Consolas, monospace; color: #5d5d60; }
  @top-right { content: ${cssString(runningRight)}; font: 7.5pt ui-monospace, Menlo, Consolas, monospace; color: #5d5d60; }
  @bottom-left { content: ${cssString(footerLeft)}; font: 7.5pt ui-monospace, Menlo, Consolas, monospace; color: #5d5d60; }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 7.5pt ui-monospace, Menlo, Consolas, monospace; color: #5d5d60; }
}
@page :first { @top-left { content: none; } @top-right { content: none; } }`;

  const title = `${reportNumber ?? 'Draft'} · Schedule of Condition · ${addressLine}`;
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${REPORT_CSS}${pageCss}</style>
</head>
<body class="${final ? 'final' : 'draft'}">
${final ? '' : '<div class="watermark" aria-hidden="true">DRAFT — not issued</div>\n<div class="draft-banner" role="note">DRAFT — not issued. Content may change until the report is issued.</div>'}
<main class="doc">
${cover}
${disclaimer}
${general}
${conditionKey}
<div class="rooms">
${rooms}
${misc}
${recorded}
</div>
${appendix}
${additional}
${declaration}
</main>
</body>
</html>
`;
}

/** Fixed column widths (the colspan header rows would otherwise make table-layout:fixed split evenly). */
const ITEM_COLGROUP = '<colgroup><col class="w-item"><col class="w-qty"><col class="w-desc"><col class="w-cond"><col class="w-comment"><col class="w-dilap"><col class="w-photo"></colgroup>';

function pill(code: string, text: string): string {
  return `<span class="pill pill-${esc(code)}">${esc(text)}</span>`;
}
