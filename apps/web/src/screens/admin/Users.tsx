import { useState, type FormEvent } from 'react';
import { ROLES, type CreateUserRequest, type Role, type UpdateUserRequest, type User } from '@soc/shared';
import { Dialog } from '../../components/Dialog';
import { EmptyState, Icon, Skeleton } from '../../components/ui';
import { api, HttpError } from '../../lib/api';
import { errorMessage, generatePassword, useApi } from '../../lib/portal';
import { useSession } from '../../lib/session';

const ROLE_LABEL: Record<Role, string> = { officer: 'Officer', manager: 'Manager', admin: 'Admin' };
const ROLE_PILL: Record<Role, string> = { officer: 'pill--teal', manager: 'pill--outline', admin: 'pill--brass' };

/** Server guard rails explained in plain words. */
function adminError(e: unknown): string {
  if (e instanceof HttpError) {
    if (e.code === 'SELF_LOCKOUT') return 'You can’t remove your own admin access or deactivate yourself — ask another admin.';
    if (e.code === 'LAST_ADMIN') return 'At least one active admin is required. Make someone else an admin first.';
    if (e.code === 'EMAIL_TAKEN') return 'A user with that email already exists.';
  }
  return errorMessage(e);
}

function OneTimeSecret({ password, who }: { password: string; who: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p>Give this password to <strong>{who}</strong>. It is shown <strong>once</strong> — it can’t be retrieved later.</p>
      <div className="secret">
        <code style={{ flex: 1 }} aria-label="New password">{password}</code>
        <button type="button" className="btn btn--xs" onClick={() => { void navigator.clipboard?.writeText(password).then(() => setCopied(true)); }}>
          <Icon name={copied ? 'check' : 'copy'} size={16} /> {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export function AdminUsers() {
  const session = useSession();
  const { data, error, loading, reload } = useApi<{ users: User[] }>('/users');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [secret, setSecret] = useState<{ password: string; who: string } | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const patch = async (u: User, change: UpdateUserRequest, ok: string) => {
    setNotice(null);
    try {
      await api(`/users/${u.id}`, { method: 'PATCH', json: change });
      setNotice({ tone: 'ok', text: ok });
      reload();
    } catch (e) {
      setNotice({ tone: 'bad', text: adminError(e) });
    }
  };
  const resetPassword = async (u: User) => {
    if (!confirm(`Reset the password for ${u.name}? Their current sessions will end.`)) return;
    const password = generatePassword();
    try {
      await api(`/users/${u.id}/reset-password`, { method: 'POST', json: { password } });
      setSecret({ password, who: u.name });
    } catch (e) {
      setNotice({ tone: 'bad', text: adminError(e) });
    }
  };

  const users = [...(data?.users ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="kicker">Administration</div>
          <h1 className="title">Users</h1>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}><Icon name="plus" size={18} /> Add user</button>
      </div>
      {notice && <div className={`notice${notice.tone === 'bad' ? ' notice--strong' : ' notice--success'}`} role={notice.tone === 'bad' ? 'alert' : 'status'}>{notice.text}</div>}
      {error && <div className="notice notice--strong" role="alert">{error}</div>}
      {loading && !data && <Skeleton lines={6} />}
      {data && users.length === 0 && <EmptyState icon="users" title="No users yet" />}
      {users.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <caption className="visually-hidden">Users</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={u.active ? undefined : { opacity: 0.72 }}>
                  <th scope="row"><span className="addr">{u.name}</span>{u.id === session?.id && <span className="pill" style={{ marginLeft: 8 }}>You</span>}</th>
                  <td>{u.email}</td>
                  <td><span className={`pill ${ROLE_PILL[u.role]}`}>{ROLE_LABEL[u.role]}</span></td>
                  <td>{u.active ? <span className="yes"><span className="dot" /> Active</span> : <span className="muted">Deactivated</span>}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="btn btn--xs" onClick={() => setEditing(u)} aria-label={`Edit ${u.name}`}><Icon name="edit" size={16} /> Edit</button>
                      <button type="button" className="btn btn--xs" onClick={() => void resetPassword(u)} aria-label={`Reset password for ${u.name}`}><Icon name="key" size={16} /> Reset password</button>
                      {u.active
                        ? <button type="button" className="btn btn--xs btn--danger" onClick={() => { if (confirm(`Deactivate ${u.name}? They will be signed out and can’t sign in.`)) void patch(u, { active: false }, `${u.name} deactivated.`); }}>Deactivate</button>
                        : <button type="button" className="btn btn--xs" onClick={() => void patch(u, { active: true }, `${u.name} reactivated.`)}>Reactivate</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateUserDialog open={creating} onClose={() => setCreating(false)} onCreated={(u, password) => { reload(); setSecret({ password, who: u.name }); }} />
      <EditUserDialog user={editing} onClose={() => setEditing(null)} onSave={(u, change) => patch(u, change, `${u.name} updated.`).then(() => setEditing(null))} />
      <Dialog open={!!secret} title="Password created" onClose={() => setSecret(null)}>
        {secret && <OneTimeSecret {...secret} />}
        <div className="dialog__actions"><button type="button" className="btn btn--primary" onClick={() => setSecret(null)}>Done</button></div>
      </Dialog>
    </div>
  );
}

function CreateUserDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (u: User, password: string) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('officer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const password = generatePassword();
    const req: CreateUserRequest = { name: name.trim(), email: email.trim().toLowerCase(), role, password };
    try {
      const { user } = await api<{ user: User }>('/users', { method: 'POST', json: req });
      setName(''); setEmail(''); setRole('officer');
      onClose();
      onCreated(user, password);
    } catch (err) {
      setError(adminError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} title="Add user" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)}>
        <div className="field"><label className="field__label" htmlFor="nu-name">Full name</label>
          <input id="nu-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="off" /></div>
        <div className="field"><label className="field__label" htmlFor="nu-email">Work email</label>
          <input id="nu-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" /></div>
        <div className="field"><label className="field__label" htmlFor="nu-role">Role</label>
          <select id="nu-role" className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select></div>
        <p className="small muted">A strong password is generated and shown once after the user is created.</p>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={busy || !name.trim() || !email.includes('@')}>{busy ? 'Creating…' : 'Create user'}</button>
        </div>
      </form>
    </Dialog>
  );
}

function EditUserDialog({ user, onClose, onSave }: { user: User | null; onClose: () => void; onSave: (u: User, change: UpdateUserRequest) => Promise<void> }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('officer');
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (user && shownFor !== user.id) { setShownFor(user.id); setName(user.name); setRole(user.role); }
  if (!user && shownFor) setShownFor(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const change: UpdateUserRequest = {};
    if (name.trim() && name.trim() !== user.name) change.name = name.trim();
    if (role !== user.role) change.role = role;
    if (!Object.keys(change).length) { onClose(); return; }
    void onSave(user, change);
  };
  return (
    <Dialog open={!!user} title={`Edit ${user?.name ?? 'user'}`} onClose={onClose}>
      {user && (
        <form onSubmit={submit}>
          <div className="field"><label className="field__label" htmlFor="eu-name">Full name</label>
            <input id="eu-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div className="field"><label className="field__label" htmlFor="eu-role">Role</label>
            <select id="eu-role" className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select></div>
          <p className="small muted">{user.email}</p>
          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn--primary">Save changes</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
