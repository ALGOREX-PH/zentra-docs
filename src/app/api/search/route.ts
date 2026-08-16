/**
 * Full-text search over the documentation, backing the search dialog.
 *
 * The index is Orama, built by `createFromSource` from the same loader the docs
 * pages render from, so a page that exists is a page that is findable and there
 * is no second source of truth to drift.
 *
 * The handler is written out rather than re-exported from `createFromSource`.
 * Its built-in `GET` is a thin convenience — it reads `query`, `locale`, `tag`
 * and `limit` straight off the URL and hands them to Orama unchecked — which
 * left this the one route in the app outside every guarantee the others hold.
 * No request id in or out, no log line, no rate limit, no cache directive, and
 * a failure surfacing as whatever the framework happened to render rather than
 * as the error envelope every client of this API already knows how to read. A
 * query is also not free: it is tokenised and scored against the whole index in
 * this process, so an unbounded one is a way to spend our CPU on request. Every
 * parameter is therefore bounded here before it reaches the index, and the
 * search itself runs inside `route` like everything else.
 *
 * The response body is unchanged — the array of results the search client
 * expects, and an empty array for an empty query.
 */

import { createFromSource } from 'fumadocs-core/search/server';
import { upstreamUnavailable } from '@/lib/api/errors';
import { log } from '@/lib/api/logger';
import { countRequest, type RateLimitOptions } from '@/lib/api/rate-limit';
import { json, methodNotAllowed, route } from '@/lib/api/route';
import { parseSearchQuery, type SearchQuery } from '@/lib/api/validation';
import { source } from '@/lib/source';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Generous, because the dialog searches as the user types and every keystroke
 * that misses the CDN lands here. Tight enough that scripting the index for
 * CPU still costs something.
 */
const SEARCH_LIMIT: RateLimitOptions = { limit: 120, windowMs: 60_000 };

/**
 * How long a CDN may serve a result set before revalidating.
 *
 * The index only changes when the content does, and the content only changes on
 * a deploy — so unlike the live dashboards this can be cached hard. Caches key
 * on the full URL, query string included, which is what makes a shared cache
 * correct here: two callers asking the same question deserve the same answer,
 * and there is nothing per-caller in it.
 */
const SEARCH_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=3600';

/**
 * The Orama server, built once per process.
 *
 * `createFromSource` is lazy inside — the index is assembled on the first
 * `search` call, not here — so this stays cheap at module load and the cost
 * lands on the first request rather than on every cold start that never
 * searches anything.
 */
const server = createFromSource(source, {
  // https://docs.orama.com/docs/orama-js/supported-languages
  language: 'english',
});

export const GET = route('search.query', async (request, { requestId }) => {
  // The shared `countRequest` rather than `enforceRateLimit`, because this
  // response is publicly cacheable: the `X-RateLimit-*` headers describe one
  // caller, and a shared cache would hand one caller's remaining budget to
  // everybody who asked the same question afterwards. A 429 still carries
  // `Retry-After`, and the wrapper marks every error `no-store`.
  countRequest(request, 'search:read', SEARCH_LIMIT);

  const parameters = parseSearchQuery(new URL(request.url).searchParams);

  // An empty query is not an error and never was: the dialog issues one every
  // time it opens, before anything has been typed. It gets the same empty array
  // it always did, and never reaches the index.
  if (parameters.query.length === 0) {
    return json([], { headers: { 'cache-control': SEARCH_CACHE_CONTROL } });
  }

  const results = await runSearch(parameters, requestId);

  return json(results, { headers: { 'cache-control': SEARCH_CACHE_CONTROL } });
});

/** Everything else is a 405 in the standard envelope, not Next's bare default. */
export const { POST, PUT, PATCH, DELETE } = methodNotAllowed(['GET']);

/**
 * Run the validated query against the index, mapping a failure to a 503.
 *
 * An Orama error can quote the query and the internal schema, so the caller is
 * told only that search is unavailable and the real error goes to the log.
 */
async function runSearch(parameters: SearchQuery, requestId: string) {
  const { query, locale, tag, limit } = parameters;

  try {
    return await server.search(query, { locale, tag, limit });
  } catch (error) {
    // The query itself is the user's own words and is not written to the drain;
    // its length is enough to tell a pathological request from a normal one.
    log('error', 'search.failed', { requestId, queryLength: query.length, err: error });
    throw upstreamUnavailable('Search is temporarily unavailable.');
  }
}
