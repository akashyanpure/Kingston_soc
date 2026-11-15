import { useEffect, useState, type FormEvent } from 'react';
import type { User } from '@soc/shared';
import { KINGSTON_CREST, LOGO_ALT } from '@soc/report';
import { ThamesLight } from '../components/ThamesLight';
import { Icon } from '../components/ui';
import { HttpError, NetworkError, isServiceOffline } from '../lib/api';
import { devLogin, fetchDevUsers, login, serviceSwitchedOff } from '../lib/session';

const initials = (name: string) => name.split(/[\s.]+/).filter(Boolean).map((p) => p[0]!.toUpperCase()).slice(0, 2).join('');

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devUsers, setDevUsers] = useState<User[] | null>(null);
  const [switchedOff, setSwitchedOff] = useState(false);

  useEffect(() => {
    void fetchDevUsers().then(setDevUsers);
    void serviceSwitchedOff().then(setSwitchedOff);
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn(); // LoginRoute redirects as soon as the session exists
    } catch (e) {
      if (isServiceOffline(e)) { setSwitchedOff(true); return; }
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
    <div className="login">
      <ThamesLight />
      <div className="on-light">
        <div className="login__crest">
          <img src={KINGSTON_CREST} alt={LOGO_ALT} />
          <div>Royal Borough of<br />Kingston upon Thames<br /><span style={{ fontWeight: 500, letterSpacing: '0.04em' }}>Private Sector Schemes</span></div>
        </div>
        <h1 className="login__title">Schedule of <em>Condition</em></h1>
        <p className="login__lede">Inspect, grade and photograph on site. Everything saves on this phone and uploads itself when there is signal.</p>

        {switchedOff && (
          <div className="notice notice--ivory" role="status">
            The service is switched off right now. Ask your administrator to start it.
          </div>
        )}
        <form onSubmit={submit} noValidate className="card login__card">
          <div className="field">
            <label className="field__label" htmlFor="email">Work email</label>
            <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="password">Password</label>
            <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button className="btn btn--primary btn--block btn--lg" type="submit" disabled={busy || !email || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {devUsers && devUsers.length > 0 && (
          <section aria-labelledby="dev-users">
            <h2 id="dev-users" className="divider">Development · sign in as</h2>
            {devUsers.map((u) => (
              <button key={u.id} type="button" className="persona" disabled={busy} onClick={() => void run(() => devLogin(u.id))}>
                <span className="persona__avatar" aria-hidden="true">{initials(u.name)}</span>
                <span>
                  <span className="persona__name">{u.name}</span>
                  <span className="persona__email">{u.email}</span>
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <span className="pill pill--teal">{u.role}</span>
                  <Icon name="chevronRight" size={18} style={{ color: 'var(--teal)' }} />
                </span>
              </button>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
