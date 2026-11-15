import { Link } from 'react-router';
import { ROLES, type AuditEvent, type DescriptionPhrase, type FormSummary, type SystemStatus, type User } from '@soc/shared';
import { Icon, Skeleton } from '../../components/ui';
import { fmtDay, relativeTime, useApi, usePageTitle } from '../../lib/portal';
import { useSession } from '../../lib/session';

const ROLE_LABEL = { officer: 'Officers', manager: 'Managers', admin: 'Admins' } as const;

/** Administration landing: one tile per area, each linking to its page. */
export function AdminOverview() {
  usePageTitle('Administration');
  const session = useSession();
  const users = useApi<{ users: User[] }>('/users');
  const system = useApi<SystemStatus>('/admin/system');
  const phrases = useApi<{ phrases: DescriptionPhrase[] }>('/admin/phrases');
  const form = useApi<FormSummary>('/admin/form');
  const audit = useApi<{ events: AuditEvent[] }>('/admin/audit?limit=10');

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="kicker">Private Sector Schemes · {session?.name}</div>
          <h1 className="title">Administration</h1>
        </div>
      </div>

      <div className="admin-tiles">
        <Link to="/admin/users" className="panel admin-tile">
          <div className="panel__head"><h2 className="panel__title"><Icon name="users" size={18} /> Users</h2><Icon name="chevronRight" size={18} /></div>
          <div className="panel__body">
            {!users.data ? <Skeleton lines={3} card={false} /> : (
              <>
                <div className="admin-tile__big">{users.data.users.filter((u) => u.active).length}<span> active</span></div>
                <ul className="admin-tile__list">
                  {ROLES.map((r) => {
                    const all = users.data!.users.filter((u) => u.role === r);
                    const inactive = all.filter((u) => !u.active).length;
                    return <li key={r}><span>{ROLE_LABEL[r]}</span><span className="num">{all.length - inactive}{inactive ? <span className="muted"> · {inactive} inactive</span> : null}</span></li>;
                  })}
                </ul>
              </>
            )}
          </div>
        </Link>

        <Link to="/admin/system" className="panel admin-tile">
          <div className="panel__head"><h2 className="panel__title"><Icon name="activity" size={18} /> System health</h2><Icon name="chevronRight" size={18} /></div>
          <div className="panel__body">
            {!system.data ? <Skeleton lines={3} card={false} /> : (
              <>
                <div className="admin-tile__big health">
                  <span className={`health__dot${system.data.db ? '' : ' health__dot--bad'}`} aria-hidden="true" />{system.data.db ? 'All systems OK' : 'Database down'}
                </div>
                <ul className="admin-tile__list">
                  <li><span>PDF queue</span><span className="num">{system.data.jobs.queued} queued · {system.data.jobs.running} running</span></li>
                  <li><span>Failed jobs</span><span className={`num${system.data.jobs.failed ? ' no' : ''}`}>{system.data.jobs.failed}</span></li>
                  <li><span>Reports issued</span><span className="num">{system.data.counts.reports}</span></li>
                </ul>
              </>
            )}
          </div>
        </Link>

        <Link to="/admin/library" className="panel admin-tile">
          <div className="panel__head"><h2 className="panel__title"><Icon name="book" size={18} /> Description library</h2><Icon name="chevronRight" size={18} /></div>
          <div className="panel__body">
            {!phrases.data ? <Skeleton lines={2} card={false} /> : (
              <>
                <div className="admin-tile__big">{phrases.data.phrases.length}<span> phrases</span></div>
                <p className="small muted" style={{ margin: 0 }}>Across {new Set(phrases.data.phrases.map((p) => p.itemCode)).size} items · one-tap descriptions for officers</p>
              </>
            )}
          </div>
        </Link>

        <Link to="/admin/form" className="panel admin-tile">
          <div className="panel__head"><h2 className="panel__title"><Icon name="layers" size={18} /> Form &amp; schemes</h2><Icon name="chevronRight" size={18} /></div>
          <div className="panel__body">
            {!form.data ? <Skeleton lines={2} card={false} /> : (
              <>
                <div className="admin-tile__big">v{form.data.version}<span> published</span></div>
                <p className="small muted" style={{ margin: 0 }}>{form.data.rooms.length} rooms · {form.data.totalItems} item rows · since {fmtDay(form.data.publishedAt, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
              </>
            )}
          </div>
        </Link>
      </div>

      <section className="panel" aria-labelledby="recent-h" style={{ marginTop: 16 }}>
        <div className="panel__head">
          <h2 id="recent-h" className="panel__title"><Icon name="history" size={18} /> Recent activity</h2>
          <Link to="/admin/system" className="btn btn--xs">Full audit log</Link>
        </div>
        <div className="panel__body">
          {!audit.data ? <Skeleton lines={4} card={false} /> : audit.data.events.length === 0 ? <p className="small muted">No activity yet.</p> : (
            <ul className="action-list">
              {audit.data.events.map((e) => (
                <li key={e.id}>
                  <div>
                    <div className="action-list__title" style={{ fontSize: 15 }}>{e.actorName ?? 'System'} · <span className="muted" style={{ fontFamily: 'var(--font-body)', fontWeight: 500 }}>{e.entity.replace('_', ' ')} {e.field}</span></div>
                    <div className="action-list__meta">{relativeTime(e.at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
