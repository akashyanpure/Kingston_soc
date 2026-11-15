/**
 * Pluggable authentication.
 *
 * Sessions, cookies, `request.user` and role guards are shared. How a user proves who they
 * are is an AuthProvider chosen by AUTH_MODE:
 *   - 'local'  (now)   email + password (argon2id) + dev quick-login outside production
 *   - 'oidc'   (later) Google Workspace OIDC restricted to the council domain (`hd` claim);
 *              implement `AuthProvider` with /auth/oidc/start + /auth/oidc/callback that end in
 *              `startSession()` — nothing else changes.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Role, User } from '@soc/shared';
import type { AppContext } from '../context.js';
import { forbidden, unauthorized } from '../errors.js';
import { localAuthProvider } from './local.js';
import { SESSION_COOKIE, SESSION_TTL_MS, createSession, destroySession, lookupSession } from './sessions.js';
import type { SessionUser } from './sessions.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export interface AuthProvider {
  mode: string;
  register(app: FastifyInstance, ctx: AppContext): void;
}

const PROVIDERS: Record<AppContext['config']['authMode'], AuthProvider> = { local: localAuthProvider };

function cookieOptions(ctx: AppContext) {
  return { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: ctx.config.cookieSecure, signed: true };
}

/** Create a session for `user` and set the cookie. Every provider ends its login with this. */
export async function startSession(ctx: AppContext, req: FastifyRequest, reply: FastifyReply, user: User): Promise<void> {
  const { token } = await createSession(ctx.db, user.id, req.headers['user-agent'] ?? null);
  reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions(ctx), maxAge: SESSION_TTL_MS / 1000 });
}

export function registerAuth(app: FastifyInstance, ctx: AppContext): void {
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req, reply) => {
    req.user = null;
    const raw = req.cookies[SESSION_COOKIE];
    if (!raw) return;
    const unsigned = req.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return;
    const found = await lookupSession(ctx.db, unsigned.value);
    if (!found) {
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return;
    }
    req.user = found.user;
    if (found.touched) reply.setCookie(SESSION_COOKIE, unsigned.value, { ...cookieOptions(ctx), maxAge: SESSION_TTL_MS / 1000 });
  });

  app.post('/auth/logout', async (req, reply) => {
    const user = requireUser(req);
    await destroySession(ctx.db, user.sessionId);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/auth/me', async (req) => {
    return { user: publicUser(requireUser(req)) };
  });

  const provider = PROVIDERS[ctx.config.authMode];
  if (!provider) throw new Error(`AUTH_MODE '${ctx.config.authMode}' is not implemented`);
  provider.register(app, ctx);
}

// ── Guards ───────────────────────────────────────────────────────────────────
export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function requireRole(req: FastifyRequest, ...roles: Role[]): SessionUser {
  const user = requireUser(req);
  if (!roles.includes(user.role)) throw forbidden();
  return user;
}

export const isManager = (u: User) => u.role === 'manager' || u.role === 'admin';

/** Officers see only their own visits; managers and admins see all. */
export function assertCanAccessVisit(user: User, visit: { officerId: string }): void {
  if (!isManager(user) && visit.officerId !== user.id) throw forbidden('This visit is assigned to another officer.');
}

export const publicUser = (u: SessionUser): User => ({ id: u.id, email: u.email, name: u.name, role: u.role, active: u.active });
