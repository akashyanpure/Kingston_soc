/**
 * Thin client for the HTTP API in @soc/shared/api.ts. Same-origin (/api is proxied by
 * Vite in dev), session cookie auth.
 */
import type { ApiError } from '@soc/shared';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
/** fetch() itself failed: offline, DNS, connection refused, CORS… */
export class NetworkError extends Error {}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let fetchImpl: FetchLike = (input, init) => globalThis.fetch(input, init);
export function setFetch(f: FetchLike): void {
  fetchImpl = f;
}
export function getFetch(): FetchLike {
  return fetchImpl;
}

export async function apiRaw(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetchImpl(`/api${path}`, { credentials: 'same-origin', ...init });
  } catch (e) {
    throw new NetworkError(e instanceof Error ? e.message : 'Network error');
  }
  if (!res.ok) {
    let body: ApiError | undefined;
    try {
      body = (await res.json()) as ApiError;
    } catch {
      /* not JSON */
    }
    throw new HttpError(res.status, body?.error?.code ?? `HTTP_${res.status}`, body?.error?.message ?? res.statusText, body?.error?.details ?? body);
  }
  return res;
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await apiRaw(path, {
    ...rest,
    headers: { ...(json !== undefined ? { 'content-type': 'application/json' } : {}), accept: 'application/json', ...(headers as Record<string, string> | undefined) },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** The cloud server is switched off (S3/CloudFront still serve the app): 503 SERVICE_OFFLINE. */
export function isServiceOffline(e: unknown): boolean {
  return e instanceof HttpError && e.code === 'SERVICE_OFFLINE';
}
export const SERVICE_OFFLINE_RETRY_MS = 5 * 60_000;

/** Treat as "try again later" rather than a real rejection. */
export function isTransient(e: unknown): boolean {
  if (e instanceof NetworkError) return true;
  if (e instanceof HttpError) return e.status >= 500 || e.status === 408 || e.status === 429;
  return false;
}
