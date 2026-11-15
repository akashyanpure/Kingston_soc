import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PostcodeAutocomplete, PostcodeLookup, normalisePostcode } from '@soc/shared';
import { AddressLookupDisabled, AddressLookupUnavailable } from '../adapters/address/index.js';
import { requireUser } from '../auth/index.js';
import type { AppContext } from '../context.js';
import { HttpError, parse } from '../errors.js';

const AutocompleteQuery = z.object({ q: z.string().trim().min(2).max(8).regex(/^[A-Za-z0-9 ]+$/, 'letters, digits and spaces only') });

function mapErr(err: unknown): never {
  if (err instanceof AddressLookupDisabled) throw new HttpError(404, 'LOOKUP_DISABLED', 'Address lookup is turned off; enter the address manually.');
  if (err instanceof AddressLookupUnavailable) throw new HttpError(502, 'LOOKUP_UNAVAILABLE', 'Address lookup is unavailable right now; enter the address manually.');
  throw err;
}

/** Postcode lookup (any signed-in user). Only the postcode is sent to the provider. */
export function addressRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/address/autocomplete', async (req) => {
    requireUser(req);
    const { q } = parse(AutocompleteQuery, req.query);
    const postcodes = await ctx.address.autocomplete(q.replace(/\s+/g, ' ').toUpperCase()).catch(mapErr);
    return PostcodeAutocomplete.parse({ postcodes: postcodes.slice(0, 10) });
  });

  app.get('/address/postcode/:postcode', async (req) => {
    requireUser(req);
    const { postcode: raw } = parse(z.object({ postcode: z.string().max(16) }), req.params);
    const postcode = normalisePostcode(raw);
    if (!postcode) throw new HttpError(400, 'INVALID_POSTCODE', 'That is not a valid UK postcode.');
    const result = await ctx.address.lookup(postcode).catch(mapErr);
    if (!result) throw new HttpError(404, 'POSTCODE_NOT_FOUND', `Postcode ${postcode} was not found.`);
    return PostcodeLookup.parse(result);
  });
}
