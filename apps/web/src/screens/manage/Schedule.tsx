import { useMemo, useState } from 'react';
import { VISIT_STATUSES, type VisitStatus, type VisitSummary } from '@soc/shared';
import { AssignDialog, PropertyHistoryDialog, ScheduleVisitDialog, StatusPill, VisitPreviewDialog, useOfficers } from '../../components/manage';
import { EmptyState, Icon, Skeleton } from '../../components/ui';
import { addDays, fmtDateTime, isoDay, mondayOf, useApi, usePageTitle } from '../../lib/portal';
import { STATUS_LABEL, VISIT_TYPE_LABEL } from '../../lib/visitData';

export function ManageSchedule() {
  usePageTitle('Schedule');
  const officers = useOfficers();
  const [officerId, setOfficerId] = useState('');
  const [status, setStatus] = useState<VisitStatus | ''>('');
  const [from, setFrom] = useState(() => isoDay(addDays(mondayOf(new Date()), -7)));
  const [to, setTo] = useState(() => isoDay(addDays(mondayOf(new Date()), 13)));
  const [text, setText] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [assign, setAssign] = useState<VisitSummary | null>(null);
  const [schedule, setSchedule] = useState(false);
  const [preview, setPreview] = useState<{ id: string; title: string } | null>(null);
  const [history, setHistory] = useState<{ propertyId: string; address: string } | null>(null);

  const params = new URLSearchParams();
  if (officerId) params.set('officerId', officerId);
  if (status) params.set('status', status);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const { data, error, loading, reload } = useApi<{ visits: VisitSummary[] }>(`/visits?${params}`);

  const rows = useMemo(() => {
    const t = text.trim().toLowerCase();
    return (data?.visits ?? []).filter((v) => !t || `${v.address} ${v.postcode} ${v.officerName} ${v.reportNumber ?? ''}`.toLowerCase().includes(t));
  }, [data, text]);

  const openHistory = (v: VisitSummary) => setHistory({ propertyId: v.propertyId, address: v.address });

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="kicker">Operations</div>
          <h1 className="title">Schedule</h1>
        </div>
        <div className="page-head__actions">
          <button type="button" className="btn btn--primary" onClick={() => setSchedule(true)}><Icon name="plus" size={18} /> Schedule visit</button>
        </div>
      </div>

      <div className={`toolbar${filtersOpen ? '' : ' toolbar--collapsed'}`} role="search" aria-label="Filter visits">
        <div className="field field--keep"><label className="field__label" htmlFor="f-q">Search</label>
          <input id="f-q" className="input" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Address, officer, report no." /></div>
        <button type="button" className="btn btn--sm filters-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((o) => !o)}>
          <Icon name="menu" size={16} /> {filtersOpen ? 'Hide filters' : 'More filters'}
        </button>
        <div className="field"><label className="field__label" htmlFor="f-officer">Officer</label>
          <select id="f-officer" className="select" value={officerId} onChange={(e) => setOfficerId(e.target.value)}>
            <option value="">All officers</option>
            {officers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select></div>
        <div className="field"><label className="field__label" htmlFor="f-status">Status</label>
          <select id="f-status" className="select" value={status} onChange={(e) => setStatus(e.target.value as VisitStatus | '')}>
            <option value="">All</option>
            {VISIT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select></div>
        <div className="field"><label className="field__label" htmlFor="f-from">From</label>
          <input id="f-from" className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="field"><label className="field__label" htmlFor="f-to">To</label>
          <input id="f-to" className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>

      {error && <div className="notice notice--strong" role="alert">{error}</div>}
      {loading && !data && <Skeleton lines={6} />}
      {data && rows.length === 0 && <EmptyState icon="calendar" title="No visits match">Try a wider date range or clear the filters.</EmptyState>}
      {data && rows.length > 0 && (
        <div className="table-wrap">
          <table className="table table--stack">
            <caption className="visually-hidden">Visits ({rows.length})</caption>
            <thead>
              <tr><th scope="col">Property</th><th scope="col">Officer</th><th scope="col">When</th><th scope="col">Progress</th><th scope="col">Status</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const pct = v.itemsTotal ? Math.round((v.itemsGraded / v.itemsTotal) * 100) : 0;
                return (
                  <tr key={v.id}>
                    <td className="wrap cell--wide"><span className="addr">{v.address}</span><div className="small muted">{v.postcode} · <strong>{v.schemeCode}</strong> {VISIT_TYPE_LABEL[v.visitType]}{v.reportNumber ? ` · ${v.reportNumber}` : ''}</div></td>
                    <td data-label="Officer">{v.officerName}</td>
                    <td className="num" data-label="When">{fmtDateTime(v.scheduledAt).replace(/^\w+ /, '')}</td>
                    <td className="num" data-label="Progress" style={{ whiteSpace: 'nowrap' }}>
                      <span className="mini-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>{v.itemsGraded}/{v.itemsTotal}
                      {v.defects > 0 && <span className="pill pill--P" style={{ marginLeft: 6 }}>{v.defects}</span>}
                    </td>
                    <td data-label="Status"><StatusPill status={v.status} /></td>
                    <td className="cell--actions">
                      <div className="row-actions">
                        {v.status !== 'issued' && v.status !== 'cancelled' && (
                          <button type="button" className="btn btn--xs" onClick={() => setAssign(v)} aria-label={`Assign ${v.address}`}><Icon name="users" size={16} /> Assign</button>
                        )}
                        <button type="button" className="btn btn--xs" onClick={() => setPreview({ id: v.id, title: v.reportNumber ?? v.address })} aria-label={`View ${v.address}`}><Icon name="eye" size={16} /></button>
                        <button type="button" className="btn btn--xs" onClick={() => openHistory(v)} aria-label={`Property history for ${v.address}`}><Icon name="history" size={16} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AssignDialog visit={assign} onClose={() => setAssign(null)} onDone={reload} />
      <ScheduleVisitDialog open={schedule} onClose={() => setSchedule(false)} onDone={reload} />
      <VisitPreviewDialog visitId={preview?.id ?? null} title={preview?.title ?? ''} onClose={() => setPreview(null)} />
      <PropertyHistoryDialog propertyId={history?.propertyId ?? null} address={history?.address ?? ''} onClose={() => setHistory(null)}
        onPreview={(id, title) => { setHistory(null); setPreview({ id, title }); }} />
    </div>
  );
}
