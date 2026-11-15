import { asc } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { v7 as uuidv7 } from 'uuid';
import { isUniqueViolation, users } from '@soc/db';
import { CreateUserRequest } from '@soc/shared';
import { requireRole } from '../auth/index.js';
import { hashPassword } from '../auth/local.js';
import { toUser } from '../auth/sessions.js';
import type { AppContext } from '../context.js';
import { conflict, parse } from '../errors.js';

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
}
