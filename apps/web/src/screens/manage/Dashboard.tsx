import { useState } from 'react';
import { Link } from 'react-router';
import type { ManagerOverview } from '@soc/shared';
import { VisitPreviewDialog } from '../../components/manage';
import { EmptyState, Icon, ScreenSkeleton, StatTile } from '../../components/ui';
import { addDays, fmtDay, isoDay, mondayOf, relativeTime, useApi } from '../../lib/portal';
import { useSession } from '../../lib/session';

export function ManageDashboard() {
  const session = useSession();
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const from = isoDay(week);
  const to = isoDay(addDays(week, 6));
  const { data, error, loading } = useApi<ManagerOverview>(`/manage/overview?from=${from}&to=${to}`);
  const [preview, setPreview] = useState<{ id: string; title: string } | null>(null);
  const thisWeek = isoDay(mondayOf(new Date())) === from;
  const label = `${fmtDay(week.toISOString(), { day: 'numeric', month: 'short' })} – ${fmtDay(addDays(week, 6).toISOString(), { day: 'numeric', month: 'short', year: 'numeric' })}`;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="kicker">{session?.name} · {thisWeek ? 'This week' : 'Week of ' + fmtDay(week.toISOString())}</div>
          <h1 className="title">Operations dashboard</h1>
        </div>
        <div className="page-head__actions">
          <div className="week-picker" role="group" aria-label="Week">
            <button type="button" onClick={() => setWeek((w) => addDays(w, -7))} aria-label="Previous week"><Icon name="chevronLeft" /></button>
            <span className="week-picker__label" aria-live="polite">{label}</span>
            <button type="button" onClick={() => setWeek((w) => addDays(w, 7))} aria-label="Next week"><Icon name="chevronRight" /></button>
          </div>
          {!thisWeek && <button type="button" className="btn btn--sm" onClick={() => setWeek(mondayOf(new Date()))}>This week</button>}
          <Link to="/manage/visits" className="btn btn--primary btn--sm"><Icon name="calendar" size={18} /> Schedule</Link>
        </div>
      </div>

      {error && <div className="notice notice--strong" role="alert">{error}</div>}
      {loading && !data && <ScreenSkeleton cards={3} />}
      {data && (
        <>
          <section aria-label="Key figures" className="kpis kpis--7">
            <StatTile value={data.kpis.scheduled} label="Scheduled" />
            <StatTile value={data.kpis.inProgress} label="In progress" />
            <StatTile value={data.kpis.completed} label="Completed, not issued" />
            <StatTile value={data.kpis.issued} label="Issued" tone="brass" />
            <div className={`stat${data.kpis.unacceptableOpen ? ' stat--claret' : ''}`}>
              <div className="stat__value">{data.kpis.unacceptableOpen}</div>
              <div className="stat__label">Unacceptable items</div>
            </div>
            <div className={`stat${data.kpis.unsignedByLandlord ? ' stat--brass' : ''}`}>
              <div className="stat__value">{data.kpis.unsignedByLandlord}</div>
              <div className="stat__label">Unsigned by landlord</div>
            </div>
            <div className="stat">
              <div className="stat__value">{data.kpis.medianMinutesPerSoc ?? '—'}<span style={{ fontSize: 16, color: 'var(--muted)' }}>{data.kpis.medianMinutesPerSoc !== null ? ' min' : ''}</span></div>
              <div className="stat__label">Median time per SOC</div>
            </div>
          </section>

          <section className="panel" aria-labelledby="workload-h">
            <div className="panel__head">
              <h2 id="workload-h" className="panel__title"><Icon name="users" size={18} /> Officer workload</h2>
              <div className="legend" aria-hidden="true">
                <span><i style={{ background: '#9aa6a3' }} />Scheduled</span>
                <span><i style={{ background: 'var(--teal)' }} />In progress</span>
                <span><i style={{ background: 'var(--brass)' }} />Issued</span>
              </div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <caption className="visually-hidden">Visits per officer for the selected week</caption>
                <thead><tr><th scope="col">Officer</th><th scope="col">Load</th><th scope="col">Scheduled</th><th scope="col">In progress</th><th scope="col">Issued</th><th scope="col">Median</th></tr></thead>
                <tbody>
                  {data.byOfficer.map((o) => {
                    const total = o.scheduled + o.inProgress + o.issued;
                    const max = Math.max(1, ...data.byOfficer.map((x) => x.scheduled + x.inProgress + x.issued));
                    const w = (n: number) => `${(n / max) * 100}%`;
                    return (
                      <tr key={o.officerId}>
                        <th scope="row" className="addr" style={{ fontWeight: 600 }}>{o.name}</th>
                        <td style={{ width: '32%' }}>
                          <div className="bars" aria-label={`${total} visits`} role="img">
                            <span className="b-sched" style={{ width: w(o.scheduled) }} />
                            <span className="b-prog" style={{ width: w(o.inProgress) }} />
                            <span className="b-issued" style={{ width: w(o.issued) }} />
                          </div>
                        </td>
                        <td className="num">{o.scheduled}</td>
                        <td className="num">{o.inProgress}</td>
                        <td className="num">{o.issued}</td>
                        <td className="num">{o.medianMinutes !== null ? `${o.medianMinutes} min` : '—'}</td>
                      </tr>
                    );
                  })}
                  {data.byOfficer.length === 0 && <tr><td colSpan={6} className="muted">No officers.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <div className="panels">
            <section className="panel" aria-labelledby="u-h">
              <div className="panel__head">
                <h2 id="u-h" className="panel__title"><span className="dot" style={{ color: 'var(--u-hue)' }} /> Unacceptable items</h2>
                <span className="pill pill--U">{data.unacceptable.length}</span>
              </div>
              <div className="panel__body">
                {data.unacceptable.length === 0 ? (
                  <EmptyState icon="check" title="Nothing unacceptable">No items graded U this week.</EmptyState>
                ) : (
                  <ul className="action-list">
                    {data.unacceptable.map((u, i) => (
                      <li key={`${u.visitId}-${i}`}>
                        <div>
                          <div className="action-list__title">{u.address}</div>
                          <div className="action-list__meta">{u.postcode} · {u.room.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())} / {u.item.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())} · {u.officerName} · {relativeTime(u.at)}</div>
                          {u.comment && <div className="action-list__quote">{u.comment}</div>}
                        </div>
                        <button type="button" className="btn btn--xs" onClick={() => setPreview({ id: u.visitId, title: u.address })}><Icon name="eye" size={16} /> Open</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section className="panel" aria-labelledby="unsigned-h">
              <div className="panel__head">
                <h2 id="unsigned-h" className="panel__title"><span className="dot" style={{ color: 'var(--brass)' }} /> Issued without landlord signature</h2>
                <span className="pill pill--brass">{data.unsigned.length}</span>
              </div>
              <div className="panel__body">
                {data.unsigned.length === 0 ? (
                  <EmptyState icon="pen" title="All signed">Every report issued this week has a landlord signature.</EmptyState>
                ) : (
                  <ul className="action-list">
                    {data.unsigned.map((r) => (
                      <li key={r.reportId}>
                        <div>
                          <div className="action-list__title num">{r.reportNumber}</div>
                          <div className="action-list__meta">{r.address} · issued {relativeTime(r.issuedAt)}</div>
                        </div>
                        <span className="row" style={{ gap: 6 }}>
                          <a className="btn btn--xs" href={`/api/reports/${r.reportId}/pdf`} target="_blank" rel="noopener"><Icon name="file" size={16} /> PDF</a>
                          <button type="button" className="btn btn--xs" onClick={() => setPreview({ id: r.visitId, title: r.reportNumber })}><Icon name="eye" size={16} /> View</button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>
        </>
      )}
      <VisitPreviewDialog visitId={preview?.id ?? null} title={preview?.title ?? ''} onClose={() => setPreview(null)} />
    </div>
  );
}
