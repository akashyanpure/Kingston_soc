/** API error shape: { error: { code, message, details? } } (packages/shared/src/api.ts ApiError). */
import type { FastifyError, FastifyInstance } from 'fastify';
import { isImmutableError, isUniqueViolation } from '@soc/db';
import type { z } from 'zod';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Not signed in.') => new HttpError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have access to this.') => new HttpError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Resource') => new HttpError(404, 'NOT_FOUND', `${what} not found.`);
export const conflict = (code: string, message: string, details?: unknown) => new HttpError(409, code, message, details);

/** Validate with a shared zod schema; 400 VALIDATION_ERROR with the issues on failure. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Request is invalid.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return r.data;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found.` } });
  });
  app.setErrorHandler((err: FastifyError | HttpError | Error, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } });
    }
    if (isImmutableError(err)) {
      return reply.code(409).send({ error: { code: 'VISIT_ISSUED', message: 'This record has been issued and cannot be changed.' } });
    }
    if (isUniqueViolation(err)) {
      return reply.code(409).send({ error: { code: 'CONFLICT', message: 'A record with these details already exists.' } });
    }
    const fe = err as FastifyError;
    if (typeof fe.statusCode === 'number' && fe.statusCode < 500) {
      return reply.code(fe.statusCode).send({ error: { code: fe.code ?? 'BAD_REQUEST', message: fe.message } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong.' } });
  });
}
