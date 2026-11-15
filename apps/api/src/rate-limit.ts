/**
 * Simple in-memory fixed-window rate limiter (single API process). Good enough for the
 * login form and the public signing pages; move to Redis/Postgres if the API is scaled out.
 */
import { HttpError } from './errors.js';

export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Count one hit for `key`. Returns seconds to wait if over the limit, else 0. */
  hit(key: string): number {
    const t = this.now();
    let e = this.hits.get(key);
    if (!e || e.resetAt <= t) {
      e = { count: 0, resetAt: t + this.windowMs };
      this.hits.set(key, e);
      if (this.hits.size > 10_000) this.prune(t);
    }
    e.count++;
    return e.count > this.limit ? Math.ceil((e.resetAt - t) / 1000) : 0;
  }

  /** Forget a key (e.g. after a successful login). */
  reset(key: string): void {
    this.hits.delete(key);
  }

  private prune(t: number) {
    for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
  }
}

export class TooManyRequests extends HttpError {
  constructor(code: string, message: string, public readonly retryAfter: number) {
    super(429, code, message, { retryAfterSeconds: retryAfter });
  }
}
