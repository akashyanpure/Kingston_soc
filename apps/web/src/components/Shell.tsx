import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router';
import { useQueueCounts, useSyncStatus } from '../lib/hooks';
import { useSession } from '../lib/session';
import { syncEngine } from '../lib/sync';

/** OFFLINE · N QUEUED / N QUEUED / SYNCING / ALL SAVED — tap to sync now. */
export function SyncBanner() {
  const status = useSyncStatus();
  const q = useQueueCounts();
  let text: string;
  let mod: string;
  if (!status.online) {
    text = q.total ? `Offline · ${q.total} queued` : 'Offline · all saved on phone';
    mod = 'offline';
  } else if (status.phase === 'syncing') {
    text = q.total ? `Syncing · ${q.total} queued` : 'Syncing';
    mod = 'syncing';
  } else if (status.phase === 'auth') {
    text = q.total ? `Sign in to sync · ${q.total} queued` : 'Signed out';
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
      <span className="sync-pill__dot" aria-hidden="true" />
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

export function Shell({ wide }: { wide?: boolean }) {
  const session = useSession();
  const isManager = session?.role === 'manager' || session?.role === 'admin';
  return (
    <div className={`shell${wide ? ' shell--wide' : ''}`}>
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="statusbar">
        <Link to="/" className="statusbar__brand">KINGSTON SOC</Link>
        <SyncBanner />
      </header>
      <main id="main" className="shell__main" tabIndex={-1}>
        <Outlet />
      </main>
      {session && (
        <nav className="tabbar" aria-label="Main">
          <NavLink to="/" end>VISITS</NavLink>
          <NavLink to="/visits/new">NEW VISIT</NavLink>
          {isManager && <NavLink to="/manager">MANAGER</NavLink>}
          <NavLink to="/account">ACCOUNT</NavLink>
        </nav>
      )}
    </div>
  );
}
