import { useEffect, useState } from 'react';
import { SCHEMES, type ReportSummary, type SchemeCode } from '@soc/shared';
import { PropertyHistoryDialog, VisitPreviewDialog } from '../../components/manage';
import { SendSigningLinkDialog } from '../../components/signing';
import { EmptyState, Icon, Skeleton } from '../../components/ui';
import { fmtDay, useApi, usePageTitle } from '../../lib/portal';
import { useReference } from '../../lib/reference';
import { VISIT_TYPE_LABEL } from '../../lib/visitData';

export function ManageReports() {
  usePageTitle('Reports');
  const ref = useReference();
  const [q, setQ] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [debounced, setDebounced] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [scheme, setScheme] = useState<SchemeCode | ''>('');
  const [preview, setPreview] = useState<{ id: string; title: string } | null>(null);
  const [history, setHistory] = useState<{ propertyId: string; address: string } | null>(null);
  const [links, setLinks] = useState<ReportSummary | null>(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t); }, [q]);

  const params = new URLSearchParams();
  if (debounced) params.set('q', debounced);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (scheme) params.set('scheme', scheme);
  const { data, error, loading, reload } = useApi<{ reports: ReportSummary[] }>(`/manage/reports?${params}`);
  const schemes = ref?.schemes?.length ? ref.schemes : SCHEMES;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="kicker">Operations</div>
          <h1 className="title">Reports archive</h1>
        </div>
        {data && <span className="pill pill--outline num">{data.reports.length} report{data.reports.length === 1 ? '' : 's'}</span>}
      </div>

      <div className={`toolbar${filtersOpen ? '' : ' toolbar--collapsed'}`} role="search" aria-label="Search reports">
        <div className="field field--keep" style={{ flex: 2 }}><label className="field__label" htmlFor="r-q">Address, postcode, UPRN or report number</label>
          <input id="r-q" className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. SOC-2026-04 or KT2" /></div>
        <button type="button" className="btn btn--sm filters-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((o) => !o)}>
          <Icon name="menu" size={16} /> {filtersOpen ? 'Hide filters' : 'More filters'}
        </button>
        <div className="field"><label className="field__label" htmlFor="r-scheme">Scheme</label>
          <select id="r-scheme" className="select" value={scheme} onChange={(e) => setScheme(e.target.value as SchemeCode | '')}>
            <option value="">All schemes</option>
            {schemes.map((s) => <option key={s.code} value={s.code}>{s.code} — {s.name}</option>)}
          </select></div>
        <div className="field"><label className="field__label" htmlFor="r-from">Issued from</label>
          <input id="r-from" className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="field"><label className="field__label" htmlFor="r-to">Issued to</label>
          <input id="r-to" className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>

      {error && <div className="notice notice--strong" role="alert">{error}</div>}
      {loading && !data && <Skeleton lines={6} />}
      {data && data.reports.length === 0 && <EmptyState icon="archive" title="No reports found">Try another search or a wider date range.</EmptyState>}
      {data && data.reports.length > 0 && (
        <div className="table-wrap">
          <table className="table table--stack">
            <caption className="visually-hidden">Issued reports</caption>
            <thead>
              <tr><th scope="col">Report</th><th scope="col">Property</th><th scope="col">Issued</th><th scope="col">Defects</th><th scope="col">Landlord</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr>
            </thead>
            <tbody>
              {data.reports.map((r) => (
                <tr key={r.reportId}>
                  <td className="report-no cell--wide">{r.reportNumber}</td>
                  <td className="wrap cell--wide"><span className="addr">{r.address}</span><div className="small muted">{r.postcode} · <strong>{r.schemeCode}</strong> {VISIT_TYPE_LABEL[r.visitType]}</div></td>
                  <td className="num" data-label="Issued">{fmtDay(r.issuedAt, { day: 'numeric', month: 'short', year: 'numeric' })}<div className="small muted">{r.officerName}</div></td>
                  <td className="num" data-label="Defects">{r.defects ? <span className="pill pill--P">{r.defects}</span> : <span className="muted">0</span>}</td>
                  <td data-label="Landlord">{r.landlordSigned
                    ? <span className="yes"><Icon name="check" size={16} /> Signed</span>
                    : <button type="button" className="btn btn--xs" onClick={() => setLinks(r)} aria-label={`Send signing link for ${r.reportNumber}`}><Icon name="alert" size={15} style={{ color: 'var(--brass)' }} /> Send link</button>}</td>
                  <td className="cell--actions">
                    <div className="row-actions">
                      {r.pdfReady
                        ? <a className="btn btn--xs" href={`/api/reports/${r.reportId}/pdf`} target="_blank" rel="noopener" aria-label={`Open PDF ${r.reportNumber}`}><Icon name="file" size={16} /> PDF</a>
                        : <span className="pill">Rendering</span>}
                      <button type="button" className="btn btn--xs" onClick={() => setPreview({ id: r.visitId, title: r.reportNumber })} aria-label={`View ${r.reportNumber}`}><Icon name="eye" size={16} /></button>
                      <button type="button" className="btn btn--xs" onClick={() => setHistory({ propertyId: r.propertyId, address: r.address })} aria-label={`Property history for ${r.address}`}><Icon name="history" size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <VisitPreviewDialog visitId={preview?.id ?? null} title={preview?.title ?? ''} onClose={() => setPreview(null)} />
      <SendSigningLinkDialog open={!!links} reportId={links?.reportId ?? null} visitId={links?.visitId ?? null} reportNumber={links?.reportNumber} onClose={() => setLinks(null)} onChanged={reload} />
      <PropertyHistoryDialog propertyId={history?.propertyId ?? null} address={history?.address ?? ''} onClose={() => setHistory(null)}
        onPreview={(id, title) => { setHistory(null); setPreview({ id, title }); }} />
    </div>
  );
}
