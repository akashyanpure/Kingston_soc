/**
 * Server-side sessions (table `sessions`). The cookie carries a random 32-byte token
 * (base64url), signed with SESSION_SECRET; the database stores only SHA-256(token) as the
 * session id, so a leaked sessions table cannot be replayed. 14-day sliding expiry —
 * officers can work offline for days and still sync when they return.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import { sessions, users } from '@soc/db';
import type { Db } from '@soc/db';
import type { User } from '@soc/shared';

export const SESSION_COOKIE = 'soc_session';
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** Only write last_seen/expires when this much time has passed (avoids a write per request). */
const TOUCH_AFTER_MS = 10 * 60 * 1000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url');

export interface SessionUser extends User {
  sessionId: string;
}

export async function createSession(db: Db, userId: string, userAgent: string | null): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id: hashToken(token), userId, createdAt: now, lastSeenAt: now, expiresAt, userAgent: userAgent?.slice(0, 500) ?? null });
  return { token, expiresAt };
}

/** Resolve a token to an active user; slides the expiry. Returns null if missing/expired/inactive. */
export async function lookupSession(db: Db, token: string): Promise<{ user: SessionUser; expiresAt: Date; touched: boolean } | null> {
  const id = hashToken(token);
  const now = new Date();
  const rows = await db
    .select({ s: sessions, u: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)))
    .limit(1);
  const row = rows[0];
  if (!row || !row.u.active) return null;
  let expiresAt = row.s.expiresAt;
  let touched = false;
  if (now.getTime() - row.s.lastSeenAt.getTime() > TOUCH_AFTER_MS) {
    expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await db.update(sessions).set({ lastSeenAt: now, expiresAt }).where(eq(sessions.id, id));
    touched = true;
  }
  return { user: { ...toUser(row.u), sessionId: id }, expiresAt, touched };
}

export async function destroySession(db: Db, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function purgeExpiredSessions(db: Db): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

export function toUser(u: typeof users.$inferSelect): User {
  return { id: u.id, email: u.email, name: u.name, role: u.role, active: u.active };
}
