import { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { KINGSTON_CREST } from '@soc/report';
import { useOnline } from '../lib/hooks';
import { canAccess, homeFor, type Area } from '../lib/portal';
import { logout, useSession } from '../lib/session';
import { Icon, type IconName } from './ui';

interface NavItem { to: string; label: string; icon: IconName; end?: boolean }

const MANAGE: NavItem[] = [
  { to: '/manage', label: 'Dashboard', icon: 'grid', end: true },
  { to: '/manage/visits', label: 'Schedule', icon: 'calendar' },
  { to: '/manage/reports', label: 'Reports', icon: 'archive' },
];
const ADMIN: NavItem[] = [
  { to: '/admin', label: 'Users', icon: 'users', end: true },
  { to: '/admin/library', label: 'Description library', icon: 'book' },
  { to: '/admin/form', label: 'Form & schemes', icon: 'layers' },
  { to: '/admin/system', label: 'System', icon: 'activity' },
];

/** Route guard: signed in and allowed into `area`, otherwise to the role's own home. */
export function RequireRole({ area }: { area: Area }) {
  const session = useSession();
  const loc = useLocation();
  if (session === undefined) return null;
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (!canAccess(session.role, area)) return <Navigate to={homeFor(session.role)} replace />;
  return <Outlet />;
}

const initials = (name: string) => name.split(/[\s.]+/).filter(Boolean).map((p) => p[0]!.toUpperCase()).slice(0, 2).join('');

/** Desktop-first shell for managers and admins: sidebar on wide screens, top bar + drawer when narrow. */
export function PortalShell() {
  const session = useSession();
  const online = useOnline();
  const nav = useNavigate();
  const loc = useLocation();
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [loc.pathname]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);
  if (!session) return null;
  const isAdmin = session.role === 'admin';

  const signOut = async () => {
    await logout();
    nav('/login', { replace: true });
  };
  const group = (title: string, items: NavItem[]) => (
    <div className="side__group">
      <div className="side__heading">{title}</div>
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.end} className="side__link">
          <Icon name={i.icon} size={19} /> {i.label}
        </NavLink>
      ))}
    </div>
  );

  return (
    <div className={`portal${drawer ? ' portal--drawer' : ''}`}>
      <a href="#portal-main" className="skip-link">Skip to content</a>
      <header className="portal__topbar">
        <button type="button" className="info-btn" aria-label="Open menu" aria-expanded={drawer} aria-controls="portal-nav" onClick={() => setDrawer(true)}>
          <Icon name="menu" />
        </button>
        <span className="statusbar__brand"><img src={KINGSTON_CREST} alt="" /><span>Kingston <em>SOC</em></span></span>
        <span className="persona__avatar" aria-hidden="true" style={{ width: 36, height: 36, fontSize: 14 }}>{initials(session.name)}</span>
      </header>
      <div className="portal__scrim" onClick={() => setDrawer(false)} aria-hidden="true" />
      <nav id="portal-nav" className="side" aria-label="Portal">
        <div className="side__brand">
          <img src={KINGSTON_CREST} alt="" />
          <div>
            <div className="side__title">Kingston <em>SOC</em></div>
            <div className="side__sub">{isAdmin ? 'Administration' : 'Operations'}</div>
          </div>
        </div>
        {isAdmin && group('Administration', ADMIN)}
        {group(isAdmin ? 'Operations dashboard' : 'Operations', MANAGE)}
        <div className="side__group">
          <div className="side__heading">Field</div>
          <NavLink to="/visits" className="side__link"><Icon name="home" size={19} /> Officer app</NavLink>
        </div>
        <div className="side__user">
          <span className="persona__avatar" aria-hidden="true">{initials(session.name)}</span>
          <span style={{ minWidth: 0 }}>
            <span className="side__name">{session.name}</span>
            <span className="side__email">{session.email}</span>
          </span>
          <button type="button" className="info-btn" onClick={() => void signOut()} aria-label="Sign out" title="Sign out"><Icon name="logout" /></button>
        </div>
      </nav>
      <main id="portal-main" className="portal__main" tabIndex={-1}>
        {!online && <div className="notice notice--brass">You're offline. The manager and admin pages need a connection.</div>}
        <Outlet />
      </main>
    </div>
  );
}
