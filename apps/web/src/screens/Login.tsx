import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { User } from '@soc/shared';
import { HttpError, NetworkError } from '../lib/api';
import { devLogin, fetchDevUsers, login } from '../lib/session';

export function Login() {
  const nav = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devUsers, setDevUsers] = useState<User[] | null>(null);

  useEffect(() => { void fetchDevUsers().then(setDevUsers); }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      nav(from, { replace: true });
    } catch (e) {
      setError(
        e instanceof NetworkError ? 'No connection. You need signal the first time you sign in on this phone.'
          : e instanceof HttpError && e.status === 401 ? 'Email or password not recognised.'
            : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() => login({ email: email.trim(), password }));
  };

  return (
    <div>
      <div className="kicker">Royal Borough of Kingston · Private Sector Schemes</div>
      <h1 className="title">Sign in</h1>
      <p className="muted small">Schedule of Condition &amp; inventory. Once signed in, the app works without signal.</p>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label className="field__label" htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="password">Password</label>
          <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="btn btn--primary btn--block" type="submit" disabled={busy || !email || !password}>
          {busy ? 'SIGNING IN…' : 'SIGN IN'}
        </button>
      </form>

      {devUsers && devUsers.length > 0 && (
        <section aria-labelledby="dev-users" style={{ marginTop: 28 }}>
          <h2 id="dev-users" className="section-label">Development: sign in as</h2>
          {devUsers.map((u) => (
            <button key={u.id} type="button" className="btn btn--block" style={{ justifyContent: 'space-between', marginBottom: 6 }}
              disabled={busy} onClick={() => void run(() => devLogin(u.id))}>
              <span>{u.name}</span><span className="pill">{u.role}</span>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
