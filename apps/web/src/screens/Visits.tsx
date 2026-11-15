import { useEffect, useMemo } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Visit } from '@soc/shared';
import { EmptyState, Icon, ProgressRing, ScreenSkeleton } from '../components/ui';
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

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const dateLine = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const openDefects = [...groups.today, ...groups.week, ...groups.open].reduce((n, r) => n + r.defects, 0);

  if (rows === undefined) return <ScreenSkeleton />;

  return (
    <div>
      <header className="greeting">
        <div className="kicker">My visits</div>
        <h1 className="greeting__hello">{greeting}, {session?.name}</h1>
        <p className="greeting__date">{dateLine}</p>
        <div className="daystats">
          <span className="pill pill--teal"><span className="num">{groups.today.length}</span>&nbsp;today</span>
          <span className="pill pill--outline"><span className="num">{groups.today.length + groups.week.length}</span>&nbsp;this week</span>
          {openDefects > 0 && <span className="pill pill--P"><span className="num">{openDefects}</span>&nbsp;below good</span>}
        </div>
      </header>

      {!online && (
        <div className="notice notice--brass">No signal. Everything is saved on the phone and uploads itself when you're back in range.</div>
      )}

      {rows.length === 0 && (
        <EmptyState icon="door" title="No visits on this phone yet">
          Visits assigned to you appear here when you have signal — or start one now.
        </EmptyState>
      )}

      <VisitGroup title="Today" rows={groups.today} />
      <VisitGroup title="This week" rows={groups.week} />
      <VisitGroup title="Other open visits" rows={groups.open} />

      <Link to="/visits/new" className="btn btn--primary btn--block btn--lg" style={{ marginTop: 8 }}>
        <Icon name="plus" /> Start a new visit
      </Link>

      <VisitGroup title="Issued" rows={groups.issued.slice(0, 10)} />
    </div>
  );
}

function VisitGroup({ title, rows }: { title: string; rows: Row[] }) {
  if (!rows.length) return null;
  return (
    <section aria-label={title}>
      <h2 className="section-label">{title}</h2>
      {rows.map((r, i) => {
        const issued = r.visit.status === 'issued';
        const href = issued ? `/visits/${r.visit.id}/done` : `/visits/${r.visit.id}`;
        const time = r.visit.scheduledAt ? r.when.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'Unscheduled';
        return (
          <Link key={r.visit.id} to={href} className="card visit-card enter" style={{ ['--i' as string]: i }}>
            <div>
              <div className="chiprow">
                <span className="pill pill--outline">{r.visit.schemeCode}</span>
                <span className="pill">{VISIT_TYPE_LABEL[r.visit.visitType]}</span>
                {issued && <span className="pill pill--brass">Issued</span>}
              </div>
              <div className="visit-card__addr">{r.address}</div>
              <div className="visit-card__meta">
                {r.postcode} · {time}
                {r.visit.reportNumber ? ` · ${r.visit.reportNumber}` : ''}
              </div>
              <div className="visit-card__foot">
                <span className="small muted num">{r.graded}/{r.total} graded</span>
                {r.defects > 0 && <span className="pill pill--P num">{r.defects} below good</span>}
                {!issued && <span className={`pill${r.pct ? ' pill--teal' : ''}`}>{STATUS_LABEL[r.visit.status]}</span>}
              </div>
            </div>
            <ProgressRing pct={r.pct} size={68} tone={issued ? 'brass' : 'teal'} label={`${r.address}: ${r.pct}% graded`} />
          </Link>
        );
      })}
    </section>
  );
}
