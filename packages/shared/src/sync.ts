/**
 * Offline sync protocol (device → server).
 *
 * The device writes every change to IndexedDB first, and appends a Mutation to an
 * outbox. When online it POSTs batches to /api/sync/push. The server:
 *   - skips any mutationId already in processed_mutations (idempotent retries),
 *   - applies upserts per row with LAST-WRITE-WINS PER FIELD using clientUpdatedAt,
 *   - writes an audit_events row per changed field,
 *   - rejects writes to a visit whose status is 'issued' (immutable),
 *   - returns a result per mutation.
 * Photo binaries are uploaded separately: PUT /api/photos/:id/file (after the photo
 * row mutation has been accepted). Order on push: visit → rooms → items → others → photos.
 */
import { z } from 'zod';
import { SYNC_ENTITIES } from './enums.js';
import { zId, zTime } from './schemas.js';

export const Mutation = z.object({
  mutationId: zId,
  entity: z.enum(SYNC_ENTITIES),
  op: z.enum(['upsert', 'delete']),
  id: zId,
  /** Changed fields only (camelCase, per the entity schema). Must include visitId except for entity 'visit'. */
  data: z.record(z.string(), z.unknown()),
  clientUpdatedAt: zTime,
});
export type Mutation = z.infer<typeof Mutation>;

export const PushRequest = z.object({
  deviceId: z.string().min(1).max(100),
  mutations: z.array(Mutation).max(500),
});
export type PushRequest = z.infer<typeof PushRequest>;

export const MutationResult = z.object({
  mutationId: zId,
  status: z.enum(['applied', 'duplicate', 'rejected']),
  error: z.string().optional(),
});
export type MutationResult = z.infer<typeof MutationResult>;

export const PushResponse = z.object({
  results: z.array(MutationResult),
  serverTime: zTime,
});
export type PushResponse = z.infer<typeof PushResponse>;
