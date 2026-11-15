import { useLiveQuery } from 'dexie-react-hooks';
import type { LoginRequest, User } from '@soc/shared';
import { api, HttpError, isServiceOffline } from './api';
import { db, setMeta, type SessionUser } from './db';
import { fetchReference } from './reference';
import { syncEngine } from './sync';

const toSession = (u: User): SessionUser => ({ id: u.id, email: u.email, name: u.name, role: u.role });

async function startSession(user: User): Promise<SessionUser> {
  const s = toSession(user);
  // Fetch the form first: setting the session triggers the redirect into the app.
  try {
    await fetchReference();
  } catch (e) {
    console.warn('Reference data not loaded yet', e);
  }
  await setMeta('session', s);
  void syncEngine.syncNow({ pull: true });
  return s;
}

export async function login(req: LoginRequest): Promise<SessionUser> {
  const { user } = await api<{ user: User }>('/auth/login', { method: 'POST', json: req });
  return startSession(user);
}

/** Is the cloud service switched off? (GET /auth/me answers 503 SERVICE_OFFLINE.) Other outcomes → false. */
export async function serviceSwitchedOff(): Promise<boolean> {
  try {
    await api('/auth/me');
    return false;
  } catch (e) {
    return isServiceOffline(e);
  }
}

/** Dev-only user picker; null when the server does not offer it (production / SSO). */
export async function fetchDevUsers(): Promise<User[] | null> {
  try {
    return (await api<{ users: User[] }>('/auth/dev-users')).users;
  } catch {
    return null;
  }
}

export async function devLogin(userId: string): Promise<SessionUser> {
  const { user } = await api<{ user: User }>('/auth/dev-login', { method: 'POST', json: { userId } });
  return startSession(user);
}

/**
 * Refresh the user from the cookie session (online only). A 401 keeps the local session
 * on purpose — unsynced work stays usable; the sync banner then asks the officer to sign in again.
 */
export async function refreshMe(): Promise<void> {
  try {
    const { user } = await api<{ user: User }>('/auth/me');
    await setMeta('session', toSession(user));
  } catch (e) {
    if (!(e instanceof HttpError)) return; // offline
  }
}

export async function logout(): Promise<void> {
  try {
    await api('/auth/logout', { method: 'POST' });
  } catch {
    /* offline: still forget the local session */
  }
  await db.meta.delete('session');
}

/** undefined while loading, null when signed out. */
export function useSession(): SessionUser | null | undefined {
  return useLiveQuery(async () => ((await db.meta.get('session'))?.value as SessionUser | undefined) ?? null, []);
}
