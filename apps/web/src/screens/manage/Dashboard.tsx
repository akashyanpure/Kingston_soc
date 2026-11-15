import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { ManagerOverview, SigningLink, VisitSummary } from '@soc/shared';
import { VisitPreviewDialog } from '../../components/manage';
import { SendSigningLinkDialog } from '../../components/signing';
import { EmptyState, Icon, ScreenSkeleton } from '../../components/ui';
import { api, apiRaw, HttpError } from '../../lib/api';
import { addDays, errorMessage, fmtDay, isoDay, mondayOf, relativeTime, useApi, usePageTitle } from '../../lib/portal';
import { STATUS_LABEL, VISIT_TYPE_LABEL } from '../../lib/visitData';

/** Paper process baselines from the business case — estimates, labelled as such on screen. */
export const PAPER_MINUTES_PER_SOC = 95;
export const PAPER_WRITEUP_MINUTES_PER_SOC = 40;
const TARGET_MINUTES = 38;

export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
export function visitsToCsv(visits: VisitSummary[]): string {
  const head = ['Scheduled', 'Address', 'Postcode', 'Scheme', 'Type', 'Officer', 'Status', 'Graded', 'Items', 'Defects', 'Report'];
  return [head.join(','), ...visits.map((v) => [
    v.scheduledAt ?? '', v.address, v.postcode, v.schemeCode, VISIT_TYPE_LABEL[v.visitType], v.officerName, STATUS_LABEL[v.status],
    v.itemsGraded, v.itemsTotal, v.defects, v.reportNumber ?? '',
  ].map(csvCell).join(','))].join('\r\n');
}

/** Export CSV: server endpoint when available, otherwise built in the browser from GET /visits. */
export async function exportVisitsCsv(from: string, to: string): Promise<{ blob: Blob; source: 'server' | 'client' }> {
  const q = `from=${from}&to=${to}`;
  try {
    const res = await apiRaw(`/manage/visits.csv?${q}`);
    return { blob: await res.blob(), source: 'server' };
  } catch (e) {
    if (!(e instanceof HttpError && (e.status === 404 || e.status === 501))) throw e;
    const { visits } = await api<{ visits: VisitSummary[] }>(`/visits?${q}`);
    return { blob: new Blob([visitsToCsv(visits)], { type: 'text/csv' }), source: 'client' };
  }
}

function Kpi({ value, label, delta, tone, muted }: { value: React.ReactNode; label: string; delta?: React.ReactNode; tone?: 'brass' | 'claret'; muted?: boolean }) {
  return (
    <div className={`stat${tone ? ` stat--${tone}` : ''}`}>
      <div className="stat__value">{value}</div>
      <div className="stat__label">{label}</div>
      {delta && <div className={`stat__delta${muted ? ' stat__delta--muted' : ''}`}>{delta}</div>}
    </div>
  );
}

export function ManageDashboard() {
  usePageTitle('Inventory operations');
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const from = isoDay(week);
  const to = isoDay(addDays(week, 6));
  const { data, error, loading, reload } = useApi<ManagerOverview>(`/manage/overview?from=${from}&to=${to}`);
  const [preview, setPreview] = useState<{ id: string; title: string } | null>(null);
  const [linkFor, setLinkFor] = useState<ManagerOverview['unsigned'][number] | null>(null);
  const [linkStats, setLinkStats] = useState<{ pending: number; none: number } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const thisWeek = isoDay(mondayOf(new Date())) === from;
  const label = `${fmtDay(week.toISOString(), { day: 'numeric', month: 'short' })} – ${fmtDay(addDays(week, 6).toISOString(), { day: 'numeric', month: 'short' })}`;

  // Awaiting landlord signature: how many already have a pending signing link.
  useEffect(() => {
    setLinkStats(null);
    if (!data) return;
    let live = true;
    Promise.all(data.unsigned.map((u) => api<{ links: SigningLink[] }>(`/reports/${u.reportId}/signing-links`).then((r) => r.links).catch(() => [] as SigningLink[])))
      .then((all) => {
        if (!live) return;
        const pending = all.filter((links) => links.some((l) => l.status === 'pending')).length;
        setLinkStats({ pending, none: all.length - pending });
      });
    return () => { live = false; };
  }, [data]);

  const doExport = async () => {
    setExporting(true);
    setExportMsg(null);
    try {
      const { blob, source } = await exportVisitsCsv(from, to);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kingston-soc-visits-${from}-to-${to}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setExportMsg(source === 'server' ? 'CSV downloaded.' : 'CSV downloaded (built in the browser).');
    } catch (e) {
      setExportMsg(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  const k = data?.kpis;
  const booked = k ? k.scheduled + k.inProgress + k.completed + k.issued : 0;
  const officers = (data?.byOfficer ?? []).filter((o) => o.medianMinutes !== null);
  const scale = Math.max(PAPER_MINUTES_PER_SOC, ...officers.map((o) => o.medianMinutes ?? 0), k?.medianMinutesPerSoc ?? 0) * 1.05;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="kicker">Private Sector Schemes · week {isoWeek(week)}</div>
          <h1 className="title">Inventory operations</h1>
        </div>
        <div className="page-head__actions">
          <div className="week-picker" role="group" aria-label="Week">
            <button type="button" onClick={() => setWeek((w) => addDays(w, -7))} aria-label="Previous week"><Icon name="chevronLeft" /></button>
            <span className="week-picker__label" aria-live="polite">{label}</span>
            <button type="button" onClick={() => setWeek((w) => addDays(w, 7))} aria-label="Next week"><Icon name="chevronRight" /></button>
          </div>
          {!thisWeek && <button type="button" className="btn btn--sm" onClick={() => setWeek(mondayOf(new Date()))}>This week</button>}
          <button type="button" className="btn btn--sm" onClick={() => void doExport()} disabled={exporting}><Icon name="file" size={18} /> {exporting ? 'Exporting…' : 'Export CSV'}</button>
          <Link to="/manage/visits" className="btn btn--primary btn--sm"><Icon name="users" size={18} /> Assign visits</Link>
        </div>
      </div>
      {exportMsg && <div className="notice" role="status">{exportMsg}</div>}

      {error && <div className="notice notice--strong" role="alert">{error}</div>}
      {loading && !data && <ScreenSkeleton cards={3} />}
      {data && k && (
        <>
          <section aria-label="Key figures" className="kpis kpis--prototype">
            <Kpi value={booked} label="Visits booked" delta={`week ${isoWeek(week)} · ${k.scheduled} still to visit`} muted />
            <Kpi value={k.issued} label="Reports issued" tone="brass" delta={k.completed ? `${k.completed} completed, awaiting issue` : 'nothing waiting to issue'} muted />
            <Kpi value={k.unsignedByLandlord} label="Awaiting landlord signature" tone={k.unsignedByLandlord ? 'brass' : undefined}
              delta={linkStats ? `${linkStats.pending} signing link${linkStats.pending === 1 ? '' : 's'} pending · ${linkStats.none} none sent` : k.unsignedByLandlord ? 'checking links…' : 'all signed'} />
            <Kpi value={k.medianMinutesPerSoc !== null ? <>{k.medianMinutesPerSoc}<span style={{ fontSize: 18, color: 'var(--muted)' }}> min</span></> : '—'}
              label="Median per SOC" delta={`paper baseline (estimate): ${PAPER_MINUTES_PER_SOC} min`} />
            <Kpi value="0" label="Office write-up hours" delta={`paper baseline (estimate): ~${PAPER_WRITEUP_MINUTES_PER_SOC} min per SOC`} />
            <Kpi value={k.unacceptableOpen} label="Unacceptable items" tone={k.unacceptableOpen ? 'claret' : undefined} delta={k.unacceptableOpen ? 'need action — see below' : 'none this week'} muted />
          </section>

          <div className="two-col" style={{ marginTop: 16 }}>
            <section className="panel" aria-labelledby="median-h">
              <div className="panel__head"><h2 id="median-h" className="panel__title"><Icon name="clock" size={18} /> Median minutes per SOC</h2></div>
              <div className="panel__body">
                {officers.length === 0 && k.medianMinutesPerSoc === null ? <p className="small muted">No visits completed this week.</p> : (
                  <div role="list" aria-label="Median minutes per SOC by officer">
                    {officers.map((o) => (
                      <div key={o.officerId} className="medbar" role="listitem">
                        <span>{o.name}</span><span className="num muted">{o.medianMinutes} min</span>
                        <div className="medbar__track" aria-hidden="true">
                          <span style={{ width: `${((o.medianMinutes ?? 0) / scale) * 100}%` }} />
                          <i className="medbar__paper" style={{ left: `${(PAPER_MINUTES_PER_SOC / scale) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                    {k.medianMinutesPerSoc !== null && (
                      <div className="medbar medbar--team" role="listitem">
                        <span>Team median</span><span className="num">{k.medianMinutesPerSoc} min</span>
                        <div className="medbar__track" aria-hidden="true">
                          <span style={{ width: `${(k.medianMinutesPerSoc / scale) * 100}%` }} />
                          <i className="medbar__paper" style={{ left: `${(PAPER_MINUTES_PER_SOC / scale) * 100}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <p className="small muted" style={{ marginTop: 12, marginBottom: 0 }}>
                  <span style={{ display: 'inline-block', width: 2, height: 12, background: 'var(--u-hue)', verticalAlign: -1, marginRight: 6 }} aria-hidden="true" />
                  Paper baseline (estimate) was {PAPER_MINUTES_PER_SOC} min per SOC including office write-up. The target is {TARGET_MINUTES} min, all of it on site.
                </p>
              </div>
            </section>

            <section className="panel" aria-labelledby="workload-h">
              <div className="panel__head">
                <h2 id="workload-h" className="panel__title"><Icon name="users" size={18} /> Officer workload</h2>
                <div className="legend" aria-hidden="true">
                  <span><i style={{ background: '#9aa6a3' }} />Booked</span>
                  <span><i style={{ background: 'var(--teal)' }} />In progress</span>
                  <span><i style={{ background: 'var(--brass)' }} />Issued</span>
                </div>
              </div>
              <div className="panel__body">
                <ul className="workload" aria-label="Visits per officer for the selected week">
                  {data.byOfficer.map((o) => {
                    const max = Math.max(1, ...data.byOfficer.map((x) => x.scheduled + x.inProgress + x.issued));
                    const w = (n: number) => `${(n / max) * 100}%`;
                    return (
                      <li key={o.officerId}>
                        <div className="workload__top">
                          <span className="workload__name">{o.name}</span>
                          <span className="small muted num">{o.scheduled} booked · {o.inProgress} in progress · {o.issued} issued</span>
                        </div>
                        <div className="bars" aria-hidden="true">
                          <span className="b-sched" style={{ width: w(o.scheduled) }} />
                          <span className="b-prog" style={{ width: w(o.inProgress) }} />
                          <span className="b-issued" style={{ width: w(o.issued) }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          </div>

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
                        <span className="row-actions">
                          <button type="button" className="btn btn--xs" onClick={() => setLinkFor(r)} aria-label={`Send signing link for ${r.reportNumber}`}><Icon name="pen" size={16} /> Send link</button>
                          <button type="button" className="btn btn--xs" onClick={() => setPreview({ id: r.visitId, title: r.reportNumber })} aria-label={`View ${r.reportNumber}`}><Icon name="eye" size={16} /></button>
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
      <SendSigningLinkDialog open={!!linkFor} reportId={linkFor?.reportId ?? null} visitId={linkFor?.visitId ?? null} reportNumber={linkFor?.reportNumber}
        onClose={() => setLinkFor(null)} onChanged={reload} />
    </div>
  );
}
