import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router';
import { KINGSTON_CREST } from '@soc/report';
import { useQueueCounts, useSyncStatus } from '../lib/hooks';
import { useSession } from '../lib/session';
import { syncEngine } from '../lib/sync';
import { Icon, type IconName } from './ui';

/** Offline · N queued / N queued / Syncing / All saved — tap to sync now. */
export function SyncBanner() {
  const status = useSyncStatus();
  const q = useQueueCounts();
  let text: string;
  let mod: string;
  if (!status.online) {
    text = q.total ? `Offline · ${q.total} queued` : 'Offline · saved on phone';
    mod = 'offline';
  } else if (status.phase === 'syncing') {
    text = q.total ? `Syncing · ${q.total}` : 'Syncing';
    mod = 'syncing';
  } else if (status.phase === 'auth') {
    text = q.total ? `Sign in to sync · ${q.total}` : 'Signed out';
    mod = 'problem';
  } else if (q.total) {
    text = status.phase === 'error' ? `${q.total} queued · retrying` : `${q.total} queued`;
    mod = status.phase === 'error' ? 'problem' : 'queued';
  } else {
    text = 'All saved';
    mod = 'saved';
  }
  if (q.rejected) text += ` · ${q.rejected} rejected`;
  const detail = [
    q.mutations && `${q.mutations} change${q.mutations === 1 ? '' : 's'}`,
    q.photos && `${q.photos} photo${q.photos === 1 ? '' : 's'}`,
    q.actions && `${q.actions} action${q.actions === 1 ? '' : 's'}`,
  ].filter(Boolean).join(', ');
  return (
    <button
      type="button" className={`sync-pill sync-pill--${mod}`}
      onClick={() => void syncEngine.syncNow({ pull: true })}
      title={[detail || 'Nothing waiting to upload', status.lastError].filter(Boolean).join(' — ')}
    >
      <span className="sync-pill__dot" aria-hidden="true">{mod === 'saved' && <Icon name="check" size={11} />}</span>
      <span role="status" aria-live="polite">{text}</span>
      <span className="visually-hidden">. Tap to sync now.</span>
    </button>
  );
}

export function RequireSession() {
  const session = useSession();
  const loc = useLocation();
  if (session === undefined) return null;
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <Outlet />;
}

function Tab({ to, icon, label, end }: { to: string; icon: IconName; label: string; end?: boolean }) {
  return (
    <NavLink to={to} end={end}>
      <span className="tabbar__pill"><Icon name={icon} size={20} /></span>
      {label}
    </NavLink>
  );
}

export function Shell({ wide }: { wide?: boolean }) {
  const session = useSession();
  const isManager = session?.role === 'manager' || session?.role === 'admin';
  return (
    <div className={`shell${wide ? ' shell--wide' : ''}`}>
      <a href="#main" className="skip-link">Skip to content</a>
      {session && (
        <header className="statusbar">
          <Link to="/" className="statusbar__brand" aria-label="Kingston Schedule of Condition, home">
            <img src={KINGSTON_CREST} alt="" />
            <span>Kingston <em>SOC</em></span>
          </Link>
          <SyncBanner />
        </header>
      )}
      <main id="main" className="shell__main" tabIndex={-1}>
        <Outlet />
      </main>
      {session && (
        <nav className="tabbar" aria-label="Main">
          <Tab to="/" end icon="home" label="Visits" />
          <Tab to="/visits/new" icon="plus" label="New visit" />
          {isManager && <Tab to="/manager" icon="grid" label="Manager" />}
          <Tab to="/account" icon="user" label="Account" />
        </nav>
      )}
    </div>
  );
}
