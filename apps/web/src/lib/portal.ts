/** Role portals: where each role lands, who may open what, and a small online-only data hook. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ROLE_HOME, type Role } from '@soc/shared';
import { api, HttpError, NetworkError } from './api';

export type Area = 'officer' | 'manage' | 'admin';

export const homeFor = (role: Role | undefined | null): string => (role ? ROLE_HOME[role] : '/login');

/**
 * Strict separation (decision 2026-11-15): the phone field flow (/visits/*, /account) is for
 * officers only; /manage: manager + admin; /admin: admin only.
 */
export function canAccess(role: Role | undefined | null, area: Area): boolean {
  if (!role) return false;
  if (area === 'officer') return role === 'officer';
  if (area === 'manage') return role === 'manager' || role === 'admin';
  return role === 'admin';
}

/** Is `path` one the role may open? Used to honour a "from" redirect only when allowed. */
export function areaOf(path: string): Area | null {
  if (path.startsWith('/admin')) return 'admin';
  if (path.startsWith('/manage')) return 'manage';
  if (path.startsWith('/visits') || path.startsWith('/account')) return 'officer';
  return null;
}
export function allowedPath(role: Role, path: string): boolean {
  const area = areaOf(path);
  return area !== null && canAccess(role, area);
}

export function errorMessage(e: unknown): string {
  if (e instanceof NetworkError) return 'No connection — this page needs the server.';
  if (e instanceof HttpError) return e.message || `Request failed (${e.status})`;
  return (e as Error)?.message ?? 'Something went wrong';
}

/** Sets document.title while a page is shown. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} · Kingston SOC`;
    return () => { document.title = prev; };
  }, [title]);
}

export interface ApiState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** GET `path` (null = skip). Keeps the previous data while reloading. */
export function useApi<T>(path: string | null): ApiState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    if (!path) return;
    const mine = ++seq.current;
    setLoading(true);
    api<T>(path)
      .then((d) => { if (mine === seq.current) { setData(d); setError(null); } })
      .catch((e) => { if (mine === seq.current) setError(errorMessage(e)); })
      .finally(() => { if (mine === seq.current) setLoading(false); });
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

// ── dates (Europe/London local) ────────────────────────────────────────────────
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function mondayOf(d: Date): Date {
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}
export const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const fmtDay = (iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', opts) : '—';
export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Unscheduled';

export function relativeTime(iso: string, now = Date.now()): string {
  const s = Math.round((now - Date.parse(iso)) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** datetime-local value ↔ ISO */
export const toLocalInput = (iso: string | null | undefined) => {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fromLocalInput = (v: string) => new Date(v).toISOString();

/** Strong random password for resets/new users (shown once). Avoids look-alike characters. */
export function generatePassword(length = 18): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_!#%';
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}
