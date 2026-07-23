/**
 * The feedback API backing the `/metrics` page.
 *
 * `GET` returns the aggregate rating summary plus the most recent comments;
 * `POST` records one submission. Feedback is off-chain by default and becomes
 * on-chain once the client anchors it to the Soroban feedback contract and
 * reports the resulting transaction hash back here.
 *
 * Both handlers are defined through `route`, so request ids, structured logging
 * and the error envelope are applied uniformly and cannot be forgotten. Nothing
 * from the network is trusted until it has been through `@/lib/api/validation`,
 * and every database failure is converted into a 503 rather than surfacing a
 * driver message that could carry the connection string.
 */

import { conflict, rateLimited, upstreamUnavailable } from '@/lib/api/errors';
import { log } from '@/lib/api/logger';
import { moderateComment } from '@/lib/api/moderation';
import {
  clientKey,
  rateLimit,
  rateLimitHeaders,
  type RateLimitOptions,
} from '@/lib/api/rate-limit';
import { json, route } from '@/lib/api/route';
import { parseFeedbackInput, readJsonBody, type FeedbackInput } from '@/lib/api/validation';
import { verifyAnchor } from '@/lib/api/verify-anchor';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reads are cheap and cached at the edge, so the ceiling is generous. */
const READ_LIMIT: RateLimitOptions = { limit: 60, windowMs: 60_000 };

/** Writes hit the database and the chain, so they are deliberately tight. */
const WRITE_LIMIT: RateLimitOptions = { limit: 5, windowMs: 10 * 60_000 };

/** How many comments the summary carries. */
const RECENT_LIMIT = 10;

/**
 * How long a CDN may serve the summary before revalidating.
 *
 * The page is a live dashboard, so the window is short; `stale-while-revalidate`
 * keeps it responsive under load without ever showing badly stale numbers.
 */
const READ_CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=120';

/** Postgres unique-violation code, raised by the one-row-per-transaction index. */
const UNIQUE_VIOLATION = '23505';

/** Pause before the second anchor lookup, covering Horizon's ingestion lag. */
const ANCHOR_RETRY_DELAY_MS = 1_500;

interface Summary {
  count: number;
  average: number;
  onChain: number;
}

export const GET = route('feedback.list', async (request) => {
  const headers = enforceRateLimit(request, 'feedback:read', READ_LIMIT);

  const { summary, recent } = await readFeedback();

  return json(
    { ...summary, recent },
    { headers: { ...headers, 'cache-control': READ_CACHE_CONTROL } },
  );
});

export const POST = route('feedback.create', async (request, { requestId }) => {
  const headers = enforceRateLimit(request, 'feedback:write', WRITE_LIMIT);

  const claimed = parseFeedbackInput(await readJsonBody(request));
  const input = await confirmAnchor(claimed, requestId);

  // Screened, not refused. Telling a submitter which word tripped the filter
  // just tells them what to change, so a withheld comment is stored and
  // acknowledged exactly like any other — it simply never reaches the feed.
  const verdict = moderateComment(input.comment);
  if (!verdict.publish) {
    log('warn', 'feedback.withheld', { requestId, reason: verdict.reason, wallet: input.wallet });
  }

  await insertFeedback(input, !verdict.publish);

  // Wallet and transaction hash are public chain data, so logging them is safe
  // and makes an anchored submission traceable from the log line to the ledger.
  log('info', 'feedback.created', {
    requestId,
    rating: input.rating,
    onChain: input.onChain,
    wallet: input.wallet,
    txHash: input.txHash,
  });

  return json({ ok: true }, { status: 201, headers });
});

/**
 * Resolve an `onChain` claim against the ledger before it is believed.
 *
 * `parseFeedbackInput` can only check that a hash is well-formed, and 64 hex
 * characters are free to invent. Left unchecked, anyone could post a fabricated
 * hash and inflate the on-chain totals the dashboard reports. A claim that does
 * not verify is downgraded rather than rejected: the feedback is real and worth
 * keeping, only the badge is not earned. The hash is cleared along with it, so
 * an invented value can neither be stored nor occupy the unique index that
 * reserves one row per anchoring transaction.
 */
async function confirmAnchor(input: FeedbackInput, requestId: string): Promise<FeedbackInput> {
  if (!input.onChain || input.txHash === null) return input;

  let verdict = await verifyAnchor(input.txHash, input.wallet);

  // The client polls the RPC until the transaction succeeds before posting, but
  // Horizon ingests closed ledgers on its own schedule and can be a beat
  // behind. One retry absorbs that lag instead of penalising an honest user.
  if (!verdict.verified && verdict.reason === 'not_found') {
    await delay(ANCHOR_RETRY_DELAY_MS);
    verdict = await verifyAnchor(input.txHash, input.wallet);
  }

  if (verdict.verified) return input;

  log('warn', 'feedback.anchor_rejected', {
    requestId,
    txHash: input.txHash,
    wallet: input.wallet,
    reason: verdict.reason,
  });

  return { ...input, onChain: false, txHash: null };
}

/** Resolve after `ms`, used to space the two anchor lookups apart. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

/**
 * Fetch the aggregate summary and the latest comments.
 *
 * The two statements are issued together because neither depends on the other;
 * over Neon's HTTP driver that halves the round trips the page waits on.
 */
async function readFeedback(): Promise<{ summary: Summary; recent: unknown[] }> {
  const db = sql();

  try {
    const [summaryRows, recentRows] = await Promise.all([
      // Moderated rows are excluded from both halves, not just the visible
      // list: a withheld comment must not inflate the count or drag the
      // average either. `feedback_visible_created_at_desc_idx` serves this.
      db`
        SELECT count(*)::int AS count,
               coalesce(round(avg(rating)::numeric, 2), 0)::float AS average,
               coalesce(sum(case when on_chain then 1 else 0 end), 0)::int AS "onChain"
        FROM feedback
        WHERE NOT hidden
      `,
      db`
        SELECT rating,
               comment,
               wallet,
               tx_hash AS "txHash",
               on_chain AS "onChain",
               created_at AS "createdAt"
        FROM feedback
        WHERE NOT hidden
        ORDER BY created_at DESC
        LIMIT ${RECENT_LIMIT}
      `,
    ]);

    // The driver types a tagged query as one of several row shapes, so the cast
    // is where we assert what these two statements actually select. An empty
    // table returns a row of zeroes rather than no row, but defaulting here
    // keeps the response shape stable even if that ever changes.
    const summary = (summaryRows as unknown as Summary[])[0] ?? {
      count: 0,
      average: 0,
      onChain: 0,
    };
    return { summary, recent: recentRows as unknown as unknown[] };
  } catch (error) {
    throw storageUnavailable(error, 'feedback.read');
  }
}

/** Persist one validated submission, mapping a duplicate anchor to a 409. */
async function insertFeedback(input: FeedbackInput, hidden: boolean): Promise<void> {
  const db = sql();

  try {
    await db`
      INSERT INTO feedback (rating, comment, wallet, tx_hash, on_chain, hidden)
      VALUES (${input.rating}, ${input.comment}, ${input.wallet}, ${input.txHash}, ${input.onChain}, ${hidden})
    `;
  } catch (error) {
    // The partial unique index allows one row per anchoring transaction, so a
    // retried or double-clicked submission lands here rather than duplicating.
    if (isUniqueViolation(error)) {
      throw conflict('This transaction has already been recorded.');
    }
    throw storageUnavailable(error, 'feedback.write');
  }
}

/**
 * Log the real database failure and return the error to send in its place.
 *
 * Driver messages routinely quote the failing statement and the connection
 * target, so the client only ever learns that storage is unavailable.
 */
function storageUnavailable(error: unknown, event: string) {
  log('error', event, { err: error });
  return upstreamUnavailable('Feedback storage is temporarily unavailable.');
}

/** Whether `error` is the Postgres unique-violation this table can raise. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}
