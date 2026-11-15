import type { FastifyInstance } from 'fastify';
import { PushRequest } from '@soc/shared';
import type { PushResponse } from '@soc/shared';
import { requireUser } from '../auth/index.js';
import type { AppContext } from '../context.js';
import { parse } from '../errors.js';
import { pushMutations } from '../services/sync.js';

export function syncRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/sync/push', async (req): Promise<PushResponse> => {
    const user = requireUser(req);
    const body = parse(PushRequest, req.body);
    const results = await pushMutations(ctx.db, ctx.storage, user, body);
    return { results, serverTime: new Date().toISOString() };
  });
}
