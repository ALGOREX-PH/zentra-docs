/**
 * The signup API behind the onboarding form.
 *
 * `POST` records one registration in the `users` table; `GET` returns the
 * public progress counter the growth campaign renders. Unlike feedback, this
 * registry holds personal data — a name and an email address — so the route is
 * deliberately lopsided: the write path logs only the wallet and the rating,
 * and the read path exposes a bare count. Neither a name nor an email ever
 * leaves the database through this module, in a response or in a log line.
 *
 * Both handlers are defined through `route`, so request ids, structured logging
 * and the error envelope are applied uniformly and cannot be forgotten. Nothing
 * from the network is trusted until it has been through `@/lib/api/validation`,
 * and every database failure is converted into a 503 rather than surfacing a
 * driver message that could carry the connection string.
 */

import { conflict, rateLimited, upstreamUnavailable } from '@/lib/api/errors';
import { log } from '@/lib/api/logger';
import {
  clientKey,
  rateLimit,
  rateLimitHeaders,
  type RateLimitOptions,
} from '@/lib/api/rate-limit';
import { json, route } from '@/lib/api/route';
import { parseUserInput, readJsonBody, type UserInput } from '@/lib/api/validation';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The counter is a single cached integer, so the ceiling is generous. */
const READ_LIMIT: RateLimitOptions = { limit: 60, windowMs: 60_000 };

/**
 * Signing up is something a person does once, so the budget is far tighter
 * than the feedback write path: three attempts covers a mistyped wallet and a
 * retry, and leaves no room for scripting the registry full of addresses.
 */
const WRITE_LIMIT: RateLimitOptions = { limit: 3, windowMs: 10 * 60_000 };

/**
 * How long a CDN may serve the counter before revalidating.
 *
 * The campaign page shows a live number, so the window is short;
 * `stale-while-revalidate` absorbs a launch-day spike without ever letting the
 * figure drift far behind the table.
 */
const READ_CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=120';

/** Postgres unique-violation code, raised by the email and wallet indexes. */
const UNIQUE_VIOLATION = '23505';

export const GET = route('onboard.count', async (request) => {
  const headers = enforceRateLimit(request, 'onboard:read', READ_LIMIT);

  // Deliberately only the count. Everything else in this table is personal
  // data, and this endpoint is public and cached at the edge.
  const count = await readUserCount();

  return json({ count }, { headers: { ...headers, 'cache-control': READ_CACHE_CONTROL } });
});

export const POST = route('onboard.create', async (request, { requestId }) => {
  const headers = enforceRateLimit(request, 'onboard:write', WRITE_LIMIT);

  const input = parseUserInput(await readJsonBody(request));
  await insertUser(input);

  // Name and email are deliberately absent: they are personal data and this log
  // ships to a third-party drain. The wallet is public chain data and the rating
  // is not identifying, which is enough to trace a signup without storing a
  // person's identity somewhere it cannot be deleted from.
  log('info', 'onboard.created', {
    requestId,
    wallet: input.wallet,
    rating: input.rating,
  });

  return json({ ok: true }, { status: 201, headers });
});

/**
 * Count one request against the caller's budget, or reject it with a 429.
 *
 * Returns the `X-RateLimit-*` headers to attach to a successful response so a
 * well-behaved client can back off before it is turned away.
 */
function enforceRateLimit(
  request: Request,
  scope: string,
  options: RateLimitOptions,
): Record<string, string> {
  const result = rateLimit(clientKey(request, scope), options);
  if (!result.ok) throw rateLimited(result.retryAfterSeconds);
  return rateLimitHeaders(result);
}

/** Fetch the number of registered users, and nothing else about them. */
async function readUserCount(): Promise<number> {
  const db = sql();

  try {
    const rows = await db`SELECT count(*)::int AS count FROM users`;
    // The driver types a tagged query as one of several row shapes, so the cast
    // is where we assert what this statement actually selects. An empty table
    // returns a row of zero rather than no row, but defaulting here keeps the
    // response shape stable even if that ever changes.
    return (rows as unknown as { count: number }[])[0]?.count ?? 0;
  } catch (error) {
    throw storageUnavailable(error, 'onboard.read');
  }
}

/** Persist one validated signup, mapping a repeat registration to a 409. */
async function insertUser(input: UserInput): Promise<void> {
  const db = sql();

  try {
    // `source` is left to its column default: this route is the site form.
    await db`
      INSERT INTO users (name, email, wallet, rating, note)
      VALUES (${input.name}, ${input.email}, ${input.wallet}, ${input.rating}, ${input.note})
    `;
  } catch (error) {
    // Unique on `lower(email)` and on `wallet`, so a double-submitted form or
    // someone returning to sign up twice lands here rather than duplicating.
    // Which of the two collided is not reported: confirming that a given
    // address is already registered would turn this into a lookup oracle.
    if (isUniqueViolation(error)) {
      throw conflict('This email or wallet is already registered.');
    }
    throw storageUnavailable(error, 'onboard.write');
  }
}

/**
 * Log the real database failure and return the error to send in its place.
 *
 * Driver messages routinely quote the failing statement and the connection
 * target — and here the statement carries the signup itself — so the client
 * only ever learns that storage is unavailable.
 */
function storageUnavailable(error: unknown, event: string) {
  log('error', event, { err: error });
  return upstreamUnavailable('Signup storage is temporarily unavailable.');
}

/** Whether `error` is the Postgres unique-violation this table can raise. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}
