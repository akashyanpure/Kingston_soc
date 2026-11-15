import { useEffect, useMemo } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Visit } from '@soc/shared';
import { Corners, ProgressBar } from '../components/fields';
import { db } from '../lib/db';
import { progressOf, relevantItems, useOnline } from '../lib/hooks';
import { useSession } from '../lib/session';
import { syncEngine } from '../lib/sync';
import { STATUS_LABEL, VISIT_TYPE_LABEL, addressOf } from '../lib/visitData';

interface Row {
  visit: Visit;
  address: string;
  postcode: string;
  pct: number;
  graded: number;
  total: number;
  defects: number;
  when: Date;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
function startOfWeek(d: Date) {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
  return s;
}

export function Visits() {
  const session = useSession();
  const online = useOnline();
  useEffect(() => { void syncEngine.syncNow({ pull: true }); }, []);

  const rows = useLiveQuery(async (): Promise<Row[]> => {
    const visits = await db.visits.toArray();
    const out: Row[] = [];
    for (const v of visits) {
      if (v.status === 'cancelled') continue;
      const property = await db.properties.get(v.propertyId);
      const rooms = await db.rooms.where('visitId').equals(v.id).toArray();
      const items = await db.items.where('visitId').equals(v.id).toArray();
      const p = progressOf(relevantItems(rooms, items));
      out.push({
        visit: v, address: addressOf(property), postcode: property?.postcode ?? '',
        pct: v.status === 'issued' ? 100 : p.pct, graded: p.graded, total: p.total, defects: p.defects,
        when: new Date(v.scheduledAt ?? v.startedAt ?? v.updatedAt),
      });
    }
    return out.sort((a, b) => a.when.getTime() - b.when.getTime());
  }, []);

  const groups = useMemo(() => {
    const now = new Date();
    const today = dayKey(now);
    const wkStart = startOfWeek(now).getTime();
    const wkEnd = wkStart + 7 * 86_400_000;
    const g = { today: [] as Row[], week: [] as Row[], open: [] as Row[], issued: [] as Row[] };
    for (const r of rows ?? []) {
      if (r.visit.status === 'issued') g.issued.push(r);
      else if (dayKey(r.when) === today) g.today.push(r);
      else if (r.when.getTime() >= wkStart && r.when.getTime() < wkEnd) g.week.push(r);
      else g.open.push(r);
    }
    g.issued.reverse();
    return g;
  }, [rows]);

  const dateLine = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <div>
      <div className="row row--top" style={{ marginBottom: 14 }}>
        <div>
          <div className="kicker">{dateLine} · {session?.name}</div>
          <h1 className="title" style={{ marginBottom: 0 }}>My visits</h1>
        </div>
        <div className="small muted" style={{ textAlign: 'right' }}>
          {groups.today.length} today<br />{groups.today.length + groups.week.length} this week
        </div>
      </div>

      {!online && (
        <div className="notice">No signal. Everything is saved on the phone and uploads itself when you're back in range.</div>
      )}

      {rows && rows.length === 0 && (
        <div className="notice notice--grey">No visits on this phone yet. Visits assigned to you appear here when you have signal, or start one now.</div>
      )}

      <VisitGroup title="Today" rows={groups.today} />
      <VisitGroup title="This week" rows={groups.week} />
      <VisitGroup title="Other open visits" rows={groups.open} />

      <Link to="/visits/new" className="btn btn--primary btn--block" style={{ marginTop: 4 }}>+ START A NEW VISIT</Link>

      <VisitGroup title="Issued" rows={groups.issued.slice(0, 10)} />
    </div>
  );
}

function VisitGroup({ title, rows }: { title: string; rows: Row[] }) {
  if (!rows.length) return null;
  return (
    <section aria-label={title}>
      <h2 className="section-label">{title}</h2>
      {rows.map((r) => {
        const href = r.visit.status === 'issued' ? `/visits/${r.visit.id}/done` : `/visits/${r.visit.id}`;
        const time = r.visit.scheduledAt ? r.when.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'Unscheduled';
        return (
          <Link key={r.visit.id} to={href} className="card card--plain visit-card">
            <Corners />
            <div className="row row--top">
              <div>
                <div className="kicker">{r.visit.schemeCode} · {VISIT_TYPE_LABEL[r.visit.visitType]}</div>
                <div className="visit-card__addr">{r.address}</div>
                <div className="small muted">
                  {r.postcode} · {time}
                  {r.visit.reportNumber ? ` · ${r.visit.reportNumber}` : ''}
                </div>
              </div>
              <span className={`pill${r.visit.status === 'issued' ? ' pill--dark' : r.pct ? ' pill--teal' : ''}`}>{STATUS_LABEL[r.visit.status]}</span>
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>
              {r.graded}/{r.total} graded{r.defects ? ` · ${r.defects} below good` : ''}
            </div>
            <ProgressBar pct={r.pct} label={`${r.address}: ${r.pct}% graded`} />
          </Link>
        );
      })}
    </section>
  );
}
