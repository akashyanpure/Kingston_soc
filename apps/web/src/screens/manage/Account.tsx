import { useNavigate } from 'react-router';
import { Icon } from '../../components/ui';
import { usePageTitle } from '../../lib/portal';
import { logout, useSession } from '../../lib/session';

const ROLE_LABEL = { officer: 'Officer', manager: 'Manager', admin: 'Administrator' } as const;

/** Profile + sign out for managers (and admins) — the portal equivalent of the officer Account tab. */
export function PortalAccount() {
  usePageTitle('Account');
  const session = useSession();
  const nav = useNavigate();
  if (!session) return null;
  return (
    <div style={{ maxWidth: 560 }}>
      <div className="page-head">
        <div>
          <div className="kicker">Profile</div>
          <h1 className="title">Account</h1>
        </div>
      </div>
      <section className="card">
        <div className="row" style={{ justifyContent: 'flex-start', gap: 14 }}>
          <span className="persona__avatar" aria-hidden="true" style={{ width: 56, height: 56, fontSize: 20 }}>
            {session.name.split(/[\s.]+/).filter(Boolean).map((p) => p[0]!.toUpperCase()).slice(0, 2).join('')}
          </span>
          <div>
            <div className="serif" style={{ fontSize: 22, fontWeight: 600 }}>{session.name}</div>
            <div className="muted">{session.email}</div>
          </div>
        </div>
        <dl className="def-list" style={{ marginTop: 16 }}>
          <dt>Role</dt><dd>{ROLE_LABEL[session.role]}</dd>
          <dt>Access</dt><dd>{session.role === 'admin' ? 'Administration, plus read access to inventory operations' : 'Inventory operations: schedule, reports, signing links'}</dd>
        </dl>
      </section>
      <button type="button" className="btn btn--block btn--danger" onClick={() => void logout().then(() => nav('/login', { replace: true }))}>
        <Icon name="logout" size={18} /> Sign out
      </button>
    </div>
  );
}
