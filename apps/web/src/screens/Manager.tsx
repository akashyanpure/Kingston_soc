import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { VISIT_STATUSES, type VisitStatus, type VisitSummary } from '@soc/shared';
import { StatTile } from '../components/ui';
import { api } from '../lib/api';
import { useOnline } from '../lib/hooks';
import { useSession } from '../lib/session';
import { STATUS_LABEL, VISIT_TYPE_LABEL } from '../lib/visitData';

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Small desktop view for managers: all visits with progress, defects and status. Online only. */
export function Manager() {
  const session = useSession();
  const online = useOnline();
  const [status, setStatus] = useState<VisitStatus | ''>('');
  const [from, setFrom] = useState(() => iso(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(() => iso(new Date(Date.now() + 30 * 86_400_000)));
  const [text, setText] = useState('');
  const [visits, setVisits] = useState<VisitSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!online) return;
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    setError(null);
    api<{ visits: VisitSummary[] }>(`/visits?${q}`).then((r) => setVisits(r.visits)).catch((e: Error) => setError(e.message));
  }, [status, from, to, online]);

  const rows = useMemo(() => {
    const t = text.trim().toLowerCase();
    return (visits ?? []).filter((v) => !t || `${v.address} ${v.postcode} ${v.officerName} ${v.reportNumber ?? ''}`.toLowerCase().includes(t));
  }, [visits, text]);
  const kpis = [
    { v: rows.length, l: 'Visits' },
    { v: rows.filter((v) => v.status === 'in_progress' || v.status === 'scheduled').length, l: 'Open' },
    { v: rows.filter((v) => v.status === 'issued').length, l: 'Issued' },
    { v: rows.reduce((n, v) => n + v.defects, 0), l: 'Defects recorded' },
  ];

  if (session && session.role === 'officer') return <div className="notice notice--strong">The manager view is for managers.</div>;

  return (
    <div>
      <div className="kicker">Private Sector Schemes · Manager</div>
      <h1 className="title">Inventory operations</h1>
      {!online && <div className="notice notice--grey">The manager view needs a connection.</div>}
      <div className="kpis">
        {kpis.map((k, i) => <StatTile key={k.l} value={k.v} label={k.l} tone={i === 2 ? 'brass' : i === 3 && k.v ? 'alert' : undefined} />)}
      </div>
      <div className="filters" role="search">
        <div className="field"><label className="field__label" htmlFor="m-q">Search</label>
          <input id="m-q" className="input" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Address, officer, report no." /></div>
        <div className="field"><label className="field__label" htmlFor="m-status">Status</label>
          <select id="m-status" className="select" value={status} onChange={(e) => setStatus(e.target.value as VisitStatus | '')}>
            <option value="">All</option>
            {VISIT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select></div>
        <div className="field"><label className="field__label" htmlFor="m-from">From</label>
          <input id="m-from" className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="field"><label className="field__label" htmlFor="m-to">To</label>
          <input id="m-to" className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="table-wrap">
        <table className="table">
          <caption className="visually-hidden">Visits</caption>
          <thead>
            <tr><th scope="col">Property</th><th scope="col">Scheme</th><th scope="col">Type</th><th scope="col">Officer</th><th scope="col">When</th><th scope="col">Graded</th><th scope="col">Defects</th><th scope="col">Status</th></tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id}>
                <td><span className="addr">{v.status === 'issued' ? <Link to={`/visits/${v.id}/done`}>{v.address}</Link> : v.address}</span><div className="small muted">{v.postcode}{v.reportNumber ? ` · ${v.reportNumber}` : ''}</div></td>
                <td className="muted">{v.schemeCode}</td>
                <td className="muted">{VISIT_TYPE_LABEL[v.visitType]}</td>
                <td className="muted">{v.officerName}</td>
                <td className="muted">{v.scheduledAt ? new Date(v.scheduledAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  <span className="mini-bar" aria-hidden="true"><span style={{ width: `${v.itemsTotal ? Math.round((v.itemsGraded / v.itemsTotal) * 100) : 0}%` }} /></span>
                  {v.itemsGraded}/{v.itemsTotal}
                </td>
                <td className="num">{v.defects ? <span className="pill pill--P">{v.defects}</span> : <span className="muted">0</span>}</td>
                <td><span className={`pill${v.status === 'issued' ? ' pill--brass' : v.status === 'in_progress' ? ' pill--teal' : ''}`}>{STATUS_LABEL[v.status]}</span></td>
              </tr>
            ))}
            {visits && rows.length === 0 && <tr><td colSpan={8} className="muted">No visits match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
