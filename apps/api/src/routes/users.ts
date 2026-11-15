import { and, asc, count, eq, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { isUniqueViolation, sessions, users } from '@soc/db';
import type { Db } from '@soc/db';
import { CreateUserRequest, ResetPasswordRequest, UpdateUserRequest, zId } from '@soc/shared';
import { requireRole } from '../auth/index.js';
import { hashPassword } from '../auth/local.js';
import { toUser } from '../auth/sessions.js';
import type { AppContext } from '../context.js';
import { conflict, notFound, parse } from '../errors.js';

const IdParams = z.object({ id: zId });

export function userRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/users', async (req) => {
    requireRole(req, 'admin');
    const rows = await ctx.db.select().from(users).orderBy(asc(users.name));
    return { users: rows.map(toUser) };
  });

  app.post('/users', async (req, reply) => {
    requireRole(req, 'admin');
    const body = parse(CreateUserRequest, req.body);
    try {
      const [row] = await ctx.db.insert(users).values({
        id: uuidv7(), email: body.email, name: body.name, role: body.role, active: true, passwordHash: await hashPassword(body.password),
      }).returning();
      return reply.code(201).send({ user: toUser(row!) });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('EMAIL_TAKEN', 'A user with this email already exists.');
      throw err;
    }
  });

  /**
   * Change name / role / active. An admin cannot demote or deactivate themselves (SELF_LOCKOUT),
   * and the last active admin cannot be demoted or deactivated (LAST_ADMIN). Deactivating a user
   * ends all their sessions.
   */
  app.patch('/users/:id', async (req) => {
    const me = requireRole(req, 'admin');
    const { id } = parse(IdParams, req.params);
    const body = parse(UpdateUserRequest, req.body);
    const updated = await ctx.db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Db;
      const [target] = await tx.select().from(users).where(eq(users.id, id)).limit(1).for('update');
      if (!target) throw notFound('User');
      const losesAdmin = target.role === 'admin' && target.active && ((body.role !== undefined && body.role !== 'admin') || body.active === false);
      if (id === me.id && ((body.role !== undefined && body.role !== target.role) || body.active === false)) {
        throw conflict('SELF_LOCKOUT', 'You cannot change your own role or deactivate yourself.');
      }
      if (losesAdmin) {
        // Lock all admin rows so two concurrent demotions cannot both pass the check.
        await tx.select({ id: users.id }).from(users).where(eq(users.role, 'admin')).for('update');
        const [others] = await tx.select({ n: count() }).from(users).where(and(eq(users.role, 'admin'), eq(users.active, true), ne(users.id, id)));
        if (Number(others?.n ?? 0) === 0) throw conflict('LAST_ADMIN', 'At least one active admin must remain.');
      }
      const [row] = await tx.update(users).set({
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.role !== undefined ? { role: body.role } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      }).where(eq(users.id, id)).returning();
      if (body.active === false) await tx.delete(sessions).where(eq(sessions.userId, id));
      return row!;
    });
    return { user: toUser(updated) };
  });

  /** Set a new password (argon2id) and end all of that user's sessions. */
  app.post('/users/:id/reset-password', async (req, reply) => {
    requireRole(req, 'admin');
    const { id } = parse(IdParams, req.params);
    const body = parse(ResetPasswordRequest, req.body);
    const passwordHash = await hashPassword(body.password);
    await ctx.db.transaction(async (tx) => {
      const rows = await tx.update(users).set({ passwordHash }).where(eq(users.id, id)).returning({ id: users.id });
      if (!rows.length) throw notFound('User');
      await tx.delete(sessions).where(eq(sessions.userId, id));
    });
    return reply.code(204).send();
  });
}
