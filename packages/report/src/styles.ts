/**
 * Report stylesheet. Visual reference: docs/reference/report-preview.html (Kingston retone of
 * the "Industry" system): Barlow / Barlow Condensed, teal #17708c, square corners, condensed
 * uppercase labels, hairline rules. Fonts are referenced by name with system fallbacks — no
 * network fetch, so the draft works offline and PDF rendering is deterministic.
 * A service designer can edit this file without touching the renderer.
 */
export const REPORT_CSS = `
:root {
  --teal: #17708c; --teal-hover: #14657f; --deep: #0f5568; --deeper: #0b3d4c; --deepest: #072932;
  --tint: #cfe8ef; --tint-2: #eaf5f8; --text: #1d1f20; --muted: #5d5d60; --rule: #e0e1e3; --page: #f8f8f9; --on-dark: #f2f2f3;
  --f-head: "Barlow Condensed", "Arial Narrow", "Roboto Condensed", system-ui, sans-serif;
  --f-body: "Barlow", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  --f-mono: ui-monospace, Menlo, Consolas, "Liberation Mono", monospace;
}
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; background: var(--page); color: var(--text); font: 9.5pt/1.45 var(--f-body); }
.doc { max-width: 210mm; margin: 0 auto; background: #fff; padding: 14mm 12mm; }
h1, h2, h3 { font-family: var(--f-head); font-weight: 600; line-height: 1.12; margin: 0; break-after: avoid; }
h2 { font-size: 20pt; margin: 0 0 3mm; }
h3 { font-size: 13pt; margin: 6mm 0 2mm; text-transform: uppercase; letter-spacing: 0.03em; }
p { margin: 0 0 2.5mm; orphans: 3; widows: 3; }
.mono { font-family: var(--f-mono); }
.small { font-size: 8pt; }
.muted, .nil { color: var(--muted); }
.ref { font-family: var(--f-mono); font-size: 7.5pt; color: var(--deep); }

/* cover */
.cover { min-height: 260mm; display: flex; flex-direction: column; break-after: page; }
.cover-top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid rgba(29,31,32,.2); padding-bottom: 7mm; }
.brand-logo { display: block; height: 30mm; width: auto; }
.brand-name { font-family: var(--f-head); font-weight: 600; font-size: 15pt; letter-spacing: .06em; line-height: 1.1; }
.brand-sub { font-size: 9pt; color: var(--muted); margin-top: 2mm; }
.cover-ref { text-align: right; font-size: 8pt; color: var(--muted); line-height: 1.6; }
.cover-main { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 12mm 0; }
.cover-prefix { font-size: 10pt; letter-spacing: .16em; text-transform: uppercase; color: var(--muted); }
.cover-title { font-size: 38pt; line-height: 1.02; letter-spacing: -.01em; margin-top: 3mm; }
.rule-accent { height: 1px; background: var(--teal); margin: 8mm 0; }
.cover-at { font-family: var(--f-head); font-weight: 600; font-size: 20pt; line-height: 1.15; }
.cover-at .k { font-size: 10pt; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); margin-right: 2mm; }
.cover-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm 8mm; margin-top: 10mm; font-size: 10pt; }
.cover-field .k, .sig .k { font-size: 7.5pt; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.cover-foot { border-top: 1px solid rgba(29,31,32,.2); padding-top: 4mm; display: flex; justify-content: space-between; font-size: 8pt; color: var(--muted); }

/* sections */
.block { margin: 0 0 8mm; }
.disclaimer p { max-width: 170mm; }
.disclaimer { break-after: page; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; vertical-align: top; }
tr { break-inside: avoid; page-break-inside: avoid; }
thead { display: table-header-group; }
.kv th { width: 46mm; padding: 2.2mm 3mm 2.2mm 0; font-family: var(--f-head); font-weight: 600; letter-spacing: .04em; }
.kv td { padding: 2.2mm 0; }
.kv tr, .grid tbody tr { border-bottom: 1px solid rgba(29,31,32,.12); }
.grid thead tr { border-bottom: 1px solid rgba(29,31,32,.3); }
.grid th { padding: 1.8mm 2mm 1.8mm 0; font-size: 7.5pt; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); font-weight: 500; }
.grid tbody th { font-family: var(--f-head); font-weight: 600; font-size: 9.5pt; letter-spacing: .03em; color: var(--text); text-transform: none; }
.grid td { padding: 2mm 2mm 2mm 0; }
.key { border: 1px solid rgba(29,31,32,.2); padding: 3mm 4mm; break-inside: avoid; }
.key h3 { margin-top: 0; }
.key dl { margin: 0 0 2mm; display: grid; gap: 1.2mm; }
.key dl > div { display: grid; grid-template-columns: 14mm 1fr; align-items: baseline; }
.key dt, .key dd { margin: 0; }

/* condition pills */
.pill { display: inline-block; min-width: 7mm; text-align: center; padding: .5mm 1.6mm; font-family: var(--f-head); font-weight: 600; font-size: 8pt; letter-spacing: .06em; }
.pill-G { background: #cfe8ef; color: #0b3d4c; }
.pill-F { background: #6fb4c9; color: #072932; }
.pill-P { background: #0f5568; color: #f2f2f3; }
.pill-U { background: #072932; color: #f2f2f3; }
.pill-NA { background: #e0e1e3; color: #5d5d60; }

/* item tables */
.rooms { break-before: page; }
.room { margin: 0 0 7mm; }
.items { table-layout: fixed; font-size: 8pt; }
.items thead .running th { font-weight: 400; padding: 0 0 2mm; }
.run-head { display: flex; justify-content: space-between; font-family: var(--f-mono); font-size: 7.5pt; color: var(--text); }
.abbr { font-size: 6.5pt; line-height: 1.35; color: var(--muted); margin-top: 1mm; border-bottom: 1px solid rgba(29,31,32,.2); padding-bottom: 1.5mm; }
.items thead .room-title th { padding: 2.5mm 0 1.5mm; }
.room-name { font-family: var(--f-head); font-weight: 600; font-size: 15pt; letter-spacing: .02em; }
.room-meta { float: right; font-weight: 400; font-size: 8pt; color: var(--muted); padding-top: 2mm; }
.items thead .cols { border-bottom: 1px solid rgba(29,31,32,.35); }
.items thead .cols th { padding: 1.6mm 1.5mm 1.6mm 0; font-size: 6.5pt; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); font-weight: 500; }
.items tbody tr { border-bottom: 1px solid rgba(29,31,32,.1); }
.items td { padding: 1.5mm 1.5mm 1.5mm 0; overflow-wrap: anywhere; }
.items .item { font-family: var(--f-head); font-weight: 600; letter-spacing: .03em; }
.items .w-item { width: 27mm; } .items .w-qty { width: 9mm; } .items .w-desc { width: 32mm; } .items .w-cond { width: 18mm; }
.items .w-dilap { width: 30mm; } .items .w-photo { width: 16mm; }
.na-reason { color: var(--muted); font-style: italic; }
.empty { color: var(--muted); padding: 2.5mm 0; font-style: italic; }
.recorded { border-top: 1px solid rgba(29,31,32,.12); padding-top: 2mm; }

/* photo appendix */
.appendix { break-before: page; }
.photo-page { display: grid; grid-template-rows: 1fr 1fr; gap: 6mm; height: 238mm; break-after: page; }
.photo-page:last-child { break-after: auto; }
.appendix > p + .photo-page { height: 222mm; }
.photo { margin: 0; display: flex; flex-direction: column; min-height: 0; break-inside: avoid; }
.frame { flex: 1; min-height: 0; border: 1px solid rgba(29,31,32,.2); background: #f2f2f3; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.frame img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
.noimg { font-family: var(--f-mono); font-size: 8pt; color: var(--muted); }
.photo figcaption { font-size: 8pt; margin-top: 1.5mm; }
.photo figcaption strong { font-family: var(--f-head); letter-spacing: .04em; font-size: 10pt; }
.photo .when { float: right; color: var(--muted); font-size: 7.5pt; }
.stamp { margin: 1mm 0 0; padding: 1.4mm 2mm; background: var(--deepest); color: var(--on-dark); font: 6.5pt/1.45 var(--f-mono); white-space: pre-wrap; }

/* notes + declaration */
.notes { break-before: page; }
.notes .grid td:first-child { width: 22mm; }
.declaration p { max-width: 175mm; }
.sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 7mm; margin-top: 6mm; }
.sig { break-inside: avoid; }
.sig-box { height: 20mm; border: 1px solid rgba(29,31,32,.2); background: #f6fbfc; display: flex; align-items: center; padding: 0 3mm; margin-top: 1.5mm; overflow: hidden; }
.sig-box img { max-height: 18mm; max-width: 100%; }
.sig-name { font-family: var(--f-head); font-weight: 600; font-size: 13pt; color: var(--deeper); }
.sig-box .hint { font-size: 8pt; color: var(--muted); font-style: italic; }
.sig-meta { font-size: 7.5pt; color: var(--muted); margin-top: 1.5mm; line-height: 1.5; }
.integrity { margin-top: 8mm; border-top: 1px solid rgba(29,31,32,.2); padding-top: 4mm; display: flex; justify-content: space-between; align-items: flex-end; gap: 8mm; break-inside: avoid; }
.hash { font-size: 7pt; color: var(--muted); text-align: right; line-height: 1.6; max-width: 60mm; }

/* draft */
.watermark { position: fixed; top: 45%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font-family: var(--f-head); font-weight: 600; font-size: 64pt; letter-spacing: .06em; color: rgba(23,112,140,.12); white-space: nowrap; pointer-events: none; z-index: 10; }
.draft-banner { background: var(--deepest); color: var(--on-dark); font-family: var(--f-head); font-weight: 600; letter-spacing: .08em; text-transform: uppercase; text-align: center; padding: 2mm; font-size: 9pt; }

@media screen and (max-width: 220mm) {
  .doc { padding: 16px; }
  .cover { min-height: auto; }
  .cover-grid, .sigs { grid-template-columns: 1fr; }
  .items { table-layout: auto; }
  .photo-page { height: auto; grid-template-rows: none; }
  .frame { min-height: 50vw; }
}
@media print {
  body { background: #fff; }
  .doc { max-width: none; padding: 0; }
  .draft-banner { display: none; }
}
`;
