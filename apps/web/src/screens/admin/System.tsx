import { useState } from 'react';
import { VISIT_STATUSES, type AuditEvent, type SystemStatus } from '@soc/shared';
import { EmptyState, Icon, Skeleton, StatTile } from '../../components/ui';
import { relativeTime, useApi, usePageTitle } from '../../lib/portal';
import { STATUS_LABEL } from '../../lib/visitData';

const ENTITIES = ['', 'visit', 'item_record', 'room_instance', 'photo', 'signature', 'user', 'description_phrase', 'scheme'];
const fmtUptime = (s: number) => {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};
const show = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function AdminSystem() {
  usePageTitle('System');
  const { data, error, loading, reload } = useApi<SystemStatus>('/admin/system');
  const [entity, setEntity] = useState('');
  const audit = useApi<{ events: AuditEvent[] }>(`/admin/audit?limit=50${entity ? `&entity=${entity}` : ''}`);
  const maxStatus = data ? Math.max(1, ...Object.values(data.visitsByStatus)) : 1;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="kicker">Administration</div>
          <h1 className="title">System</h1>
        </div>
        <button type="button" className="btn btn--sm" onClick={() => { reload(); audit.reload(); }}><Icon name="sync" size={18} /> Refresh</button>
      </div>
      {error && <div className="notice notice--strong" role="alert">{error}</div>}
      {loading && !data && <Skeleton lines={6} />}
      {data && (
        <>
          <div className="kpis">
            <div className="stat">
              <div className="stat__value health"><span className={`health__dot${data.db ? '' : ' health__dot--bad'}`} aria-hidden="true" />{data.db ? 'OK' : 'Down'}</div>
              <div className="stat__label">Database</div>
            </div>
            <StatTile value={fmtUptime(data.uptimeSeconds)} label="API uptime" />
            <StatTile value={data.counts.visits} label="Visits" />
            <StatTile value={data.counts.reports} label="Reports" tone="brass" />
            <StatTile value={data.counts.properties} label="Properties" />
            <StatTile value={data.counts.users} label="Users" />
            <StatTile value={data.counts.photos} label="Photos" />
          </div>

          <div className="two-col">
            <section className="panel" aria-labelledby="vs-h">
              <div className="panel__head"><h2 id="vs-h" className="panel__title">Visits by status</h2></div>
              <div className="panel__body">
                {VISIT_STATUSES.map((s) => (
                  <div key={s} className="hbar">
                    <span>{STATUS_LABEL[s]}</span>
                    <span className="hbar__track" aria-hidden="true"><span style={{ width: `${(data.visitsByStatus[s] / maxStatus) * 100}%`, background: s === 'issued' ? 'var(--brass)' : undefined }} /></span>
                    <span className="num" style={{ textAlign: 'right' }}>{data.visitsByStatus[s]}</span>
                  </div>
                ))}
              </div>
            </section>
            <section className="panel" aria-labelledby="jobs-h">
              <div className="panel__head"><h2 id="jobs-h" className="panel__title"><Icon name="file" size={18} /> PDF job queue</h2></div>
              <div className="panel__body">
                <div className="row" style={{ justifyContent: 'flex-start', gap: 8, margin: '8px 0 12px' }}>
                  <span className="pill">{data.jobs.queued} queued</span>
                  <span className="pill pill--teal">{data.jobs.running} running</span>
                  <span className={`pill${data.jobs.failed ? ' pill--alert' : ''}`}>{data.jobs.failed} failed</span>
                </div>
                {data.recentFailedJobs.length === 0 ? <p className="small muted">No recent failures.</p> : (
                  <ul className="action-list">
                    {data.recentFailedJobs.map((j) => (
                      <li key={j.id}>
                        <div>
                          <div className="action-list__title">#{j.id} · {j.kind}</div>
                          <div className="action-list__meta">{relativeTime(j.at)}</div>
                          {j.lastError && <div className="action-list__quote mono" style={{ fontSize: 13 }}>{j.lastError}</div>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>
        </>
      )}

      <section className="panel" aria-labelledby="audit-h" style={{ marginTop: 16 }}>
        <div className="panel__head">
          <h2 id="audit-h" className="panel__title"><Icon name="history" size={18} /> Audit log</h2>
          <div className="field" style={{ margin: 0, minWidth: 200 }}>
            <label className="visually-hidden" htmlFor="audit-entity">Entity</label>
            <select id="audit-entity" className="select" value={entity} onChange={(e) => setEntity(e.target.value)}>
              {ENTITIES.map((x) => <option key={x} value={x}>{x ? x.replace('_', ' ') : 'All entities'}</option>)}
            </select>
          </div>
        </div>
        {audit.error && <div className="notice notice--strong" role="alert" style={{ margin: 16 }}>{audit.error}</div>}
        {audit.loading && !audit.data && <div style={{ padding: 16 }}><Skeleton lines={5} card={false} /></div>}
        {audit.data && audit.data.events.length === 0 && <div style={{ padding: 16 }}><EmptyState icon="history" title="No events" /></div>}
        {audit.data && audit.data.events.length > 0 && (
          <div className="table-wrap">
            <table className="table table--stack">
              <caption className="visually-hidden">Audit events, newest first</caption>
              <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Entity</th><th scope="col">Field</th><th scope="col">Change</th></tr></thead>
              <tbody>
                {audit.data.events.map((e) => (
                  <tr key={e.id}>
                    <td data-label="When" style={{ whiteSpace: 'nowrap' }} title={new Date(e.at).toLocaleString('en-GB')}>{relativeTime(e.at)}</td>
                    <td data-label="Who">{e.actorName ?? <span className="muted">system</span>}</td>
                    <td data-label="Entity"><span className="pill">{e.entity.replace('_', ' ')}</span> <span className="mono muted">{e.entityId.slice(-6)}</span></td>
                    <td data-label="Field">{e.field}</td>
                    <td className="small wrap cell--wide" data-label="Change"><span className="muted">{show(e.oldValue)}</span> <Icon name="arrowRight" size={14} style={{ display: 'inline', verticalAlign: -2, color: 'var(--muted)' }} /> <strong>{show(e.newValue)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
