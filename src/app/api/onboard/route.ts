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

import { isUniqueViolation, storageUnavailable } from '@/lib/api/db-errors';
import { conflict } from '@/lib/api/errors';
import { log } from '@/lib/api/logger';
import { requireSameOrigin } from '@/lib/api/origin';
import { countRequest, enforceRateLimit, type RateLimitOptions } from '@/lib/api/rate-limit';
import { json, READ_CACHE_CONTROL, route } from '@/lib/api/route';
import { parseUserInput, readJsonBody, type UserInput } from '@/lib/api/validation';
import { query, sql } from '@/lib/db';

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

/** What the client is told when a query fails; the real error goes to the log. */
const STORAGE_MESSAGE = 'Signup storage is temporarily unavailable.';

export const GET = route('onboard.count', async (request) => {
  countRequest(request, 'onboard:read', READ_LIMIT);

  // Deliberately only the count. Everything else in this table is personal
  // data, and this endpoint is public and cached at the edge.
  const count = await readUserCount();

  return json({ count }, { headers: { 'cache-control': READ_CACHE_CONTROL } });
});

export const POST = route('onboard.create', async (request, { requestId }) => {
  // Before the budget is spent and before the body is read. This registry holds
  // personal data, so a row written from a page we do not control is worse than
  // junk: it is somebody's name and address arriving without their intent.
  requireSameOrigin(request, requestId);

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

/** Fetch the number of registered users, and nothing else about them. */
async function readUserCount(): Promise<number> {
  try {
    const rows = await query<{ count: number }>`SELECT count(*)::int AS count FROM users`;
    // An empty table returns a row of zero rather than no row, but defaulting
    // here keeps the response shape stable even if that ever changes.
    return rows[0]?.count ?? 0;
  } catch (error) {
    throw storageUnavailable(error, 'onboard.read', STORAGE_MESSAGE);
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
    throw storageUnavailable(error, 'onboard.write', STORAGE_MESSAGE);
  }
}
