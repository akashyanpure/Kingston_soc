/**
 * AUTH_MODE=local — email + password verified with argon2id (@node-rs/argon2).
 * Dev helpers (/auth/dev-users, /auth/dev-login) exist only when NODE_ENV !== 'production'.
 */
import { hash, verify } from '@node-rs/argon2';
import { asc, eq, sql } from 'drizzle-orm';
import { users } from '@soc/db';
import { LoginRequest } from '@soc/shared';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { HttpError, parse } from '../errors.js';
import type { AuthProvider } from './index.js';
import { startSession } from './index.js';
import { toUser } from './sessions.js';

let dummyHash: Promise<string> | undefined;
/** Verify against a dummy hash when the user does not exist, so timing does not leak which emails exist. */
const getDummyHash = () => (dummyHash ??= hash('not-a-real-password-placeholder'));

export async function hashPassword(password: string): Promise<string> {
  return hash(password); // @node-rs/argon2 defaults to argon2id
}

const invalid = () => new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');

export const devAuthEnabled = (ctx: AppContext) => ctx.config.authMode === 'local' && ctx.config.nodeEnv !== 'production';

export const localAuthProvider: AuthProvider = {
  mode: 'local',
  register(app, ctx) {
    app.post('/auth/login', async (req, reply) => {
      const body = parse(LoginRequest, req.body);
      const [row] = await ctx.db.select().from(users).where(eq(sql`lower(${users.email})`, body.email.toLowerCase())).limit(1);
      if (!row || !row.passwordHash) {
        await verify(await getDummyHash(), body.password).catch(() => false);
        throw invalid();
      }
      const ok = await verify(row.passwordHash, body.password).catch(() => false);
      if (!ok || !row.active) throw invalid();
      const user = toUser(row);
      await startSession(ctx, req, reply, user);
      return { user };
    });

    if (!devAuthEnabled(ctx)) return;

    app.get('/auth/dev-users', async () => {
      const rows = await ctx.db.select().from(users).where(eq(users.active, true)).orderBy(asc(users.role), asc(users.name));
      return { users: rows.map(toUser) };
    });

    app.post('/auth/dev-login', async (req, reply) => {
      const { userId } = parse(z.object({ userId: z.uuid() }), req.body);
      const [row] = await ctx.db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!row || !row.active) throw new HttpError(404, 'NOT_FOUND', 'User not found.');
      const user = toUser(row);
      await startSession(ctx, req, reply, user);
      return { user };
    });
  },
};
