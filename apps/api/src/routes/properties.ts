import { asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { landlords, listVisits, properties } from '@soc/db';
import { CreatePropertyRequest, Landlord, Property, zId } from '@soc/shared';
import type { PropertyWithLandlord } from '@soc/shared';
import { requireRole, requireUser } from '../auth/index.js';
import type { AppContext } from '../context.js';
import { conflict, notFound, parse } from '../errors.js';

const SearchQuery = z.object({ q: z.string().trim().max(200).optional() });
const IdParams = z.object({ id: zId });

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const pick = <S extends z.ZodObject>(schema: S, row: Record<string, unknown>) =>
  schema.parse(Object.fromEntries(Object.keys(schema.shape).map((k) => [k, row[k] ?? null]))) as z.infer<S>;

export function propertyRoutes(app: FastifyInstance, ctx: AppContext): void {
  const withLandlords = async (rows: (typeof properties.$inferSelect)[]): Promise<PropertyWithLandlord[]> => {
    const ids = [...new Set(rows.map((r) => r.landlordId).filter((x): x is string => !!x))];
    const ls = ids.length ? await ctx.db.select().from(landlords).where(inArray(landlords.id, ids)) : [];
    const byId = new Map(ls.map((l) => [l.id, pick(Landlord, l)]));
    return rows.map((r) => ({ ...pick(Property, r), landlord: r.landlordId ? byId.get(r.landlordId) ?? null : null }));
  };

  app.get('/properties', async (req) => {
    requireUser(req);
    const { q } = parse(SearchQuery, req.query);
    const base = ctx.db.select().from(properties);
    let rows;
    if (q) {
      const like = `%${likeEscape(q)}%`;
      const compactPostcode = q.replace(/\s+/g, '').toLowerCase();
      rows = await base
        .where(or(
          ilike(properties.addressLine1, like),
          ilike(properties.addressLine2, like),
          sql`replace(lower(${properties.postcode}), ' ', '') like ${`%${likeEscape(compactPostcode)}%`}`,
          eq(properties.uprn, q),
        ))
        .orderBy(asc(properties.addressLine1))
        .limit(50);
    } else {
      rows = await base.orderBy(asc(properties.addressLine1)).limit(50);
    }
    return { properties: await withLandlords(rows) };
  });

  app.post('/properties', async (req, reply) => {
    requireRole(req, 'officer', 'manager', 'admin');
    const body = parse(CreatePropertyRequest, req.body);
    const [existing] = await ctx.db.select().from(properties).where(eq(properties.id, body.id)).limit(1);
    if (existing) return reply.code(200).send({ property: (await withLandlords([existing]))[0] }); // idempotent retry
    const { landlord, ...prop } = body;
    const row = await ctx.db.transaction(async (tx) => {
      let landlordId = prop.landlordId;
      if (landlord) {
        await tx.insert(landlords).values(landlord).onConflictDoNothing();
        landlordId = landlord.id;
      }
      if (landlordId) {
        const [l] = await tx.select({ id: landlords.id }).from(landlords).where(eq(landlords.id, landlordId)).limit(1);
        if (!l) throw notFound('Landlord');
      }
      const [inserted] = await tx.insert(properties).values({ ...prop, landlordId: landlordId ?? null }).returning();
      return inserted!;
    }).catch((err) => {
      if ((err as { code?: string }).code === '23505') throw conflict('CONFLICT', 'A property with this UPRN already exists.');
      throw err;
    });
    return reply.code(201).send({ property: (await withLandlords([row]))[0] });
  });

  app.get('/properties/:id/visits', async (req) => {
    requireUser(req);
    const { id } = parse(IdParams, req.params);
    const [p] = await ctx.db.select({ id: properties.id }).from(properties).where(eq(properties.id, id)).limit(1);
    if (!p) throw notFound('Property');
    return { visits: await listVisits(ctx.db, { propertyId: id }) };
  });
}
