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

import { actionLog } from '@/config/contract';
import { isUniqueViolation, storageUnavailable } from '@/lib/api/db-errors';
import { conflict } from '@/lib/api/errors';
import { log } from '@/lib/api/logger';
import { moderateComment } from '@/lib/api/moderation';
import { requireSameOrigin } from '@/lib/api/origin';
import { countRequest, enforceRateLimit, type RateLimitOptions } from '@/lib/api/rate-limit';
import { json, methodNotAllowed, READ_CACHE_CONTROL, route } from '@/lib/api/route';
import { type FeedbackInput, parseFeedbackInput, readJsonBody } from '@/lib/api/validation';
import { verifyAnchor } from '@/lib/api/verify-anchor';
import { query, sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reads are cheap and cached at the edge, so the ceiling is generous. */
const READ_LIMIT: RateLimitOptions = { limit: 60, windowMs: 60_000 };

/** Writes hit the database and the chain, so they are deliberately tight. */
const WRITE_LIMIT: RateLimitOptions = { limit: 5, windowMs: 10 * 60_000 };

/** How many comments the summary carries. */
const RECENT_LIMIT = 10;

/** Pause before the second anchor lookup, covering Horizon's ingestion lag. */
const ANCHOR_RETRY_DELAY_MS = 1_500;

/** What the client is told when a query fails; the real error goes to the log. */
const STORAGE_MESSAGE = 'Feedback storage is temporarily unavailable.';

interface Summary {
  count: number;
  average: number;
  onChain: number;
}

/** One recent comment as the SELECT below aliases it for the response. */
interface RecentRow {
  rating: number;
  comment: string;
  wallet: string | null;
  txHash: string | null;
  onChain: boolean;
  createdAt: Date;
}

export const GET = route('feedback.list', async (request) => {
  countRequest(request, 'feedback:read', READ_LIMIT);

  const { summary, recent } = await readFeedback();

  return json({ ...summary, recent }, { headers: { 'cache-control': READ_CACHE_CONTROL } });
});

export const POST = route('feedback.create', async (request, { requestId }) => {
  // Before the budget is spent and before the body is read: a submission driven
  // from someone else's page is refused outright rather than being counted
  // against the visitor whose browser was borrowed to send it.
  requireSameOrigin(request, requestId);

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

/** Everything else is a 405 in the standard envelope, not Next's bare default. */
export const { PUT, PATCH, DELETE } = methodNotAllowed(['GET', 'POST']);

/**
 * Resolve an `onChain` claim against the ledger before it is believed.
 *
 * `parseFeedbackInput` can only check that a hash is well-formed, and 64 hex
 * characters are free to invent. Left unchecked, anyone could post a fabricated
 * hash and inflate the on-chain totals the dashboard reports. The verification
 * is pinned to the feedback contract: existing and succeeding is not enough,
 * the transaction must be the claimed wallet's own invocation of that contract,
 * or the badge names an event that never happened. A claim that does not verify
 * is downgraded rather than rejected: the feedback is real and worth keeping,
 * only the badge is not earned. The hash is cleared along with it, so an
 * invented value can neither be stored nor occupy the unique index that
 * reserves one row per anchoring transaction.
 */
async function confirmAnchor(input: FeedbackInput, requestId: string): Promise<FeedbackInput> {
  if (!input.onChain || input.txHash === null) return input;

  let verdict = await verifyAnchor(input.txHash, input.wallet, actionLog.feedbackId);

  // The client polls the RPC until the transaction succeeds before posting, but
  // Horizon ingests closed ledgers on its own schedule and can be a beat
  // behind. One retry absorbs that lag instead of penalising an honest user.
  if (!verdict.verified && verdict.reason === 'not_found') {
    await delay(ANCHOR_RETRY_DELAY_MS);
    verdict = await verifyAnchor(input.txHash, input.wallet, actionLog.feedbackId);
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
 * Fetch the aggregate summary and the latest comments.
 *
 * The two statements are issued together because neither depends on the other;
 * over Neon's HTTP driver that halves the round trips the page waits on.
 */
async function readFeedback(): Promise<{ summary: Summary; recent: RecentRow[] }> {
  try {
    const [summaryRows, recentRows] = await Promise.all([
      // Moderated rows are excluded from both halves, not just the visible
      // list: a withheld comment must not inflate the count or drag the
      // average either. `feedback_visible_created_at_desc_idx` serves this.
      query<Summary>`
        SELECT count(*)::int AS count,
               coalesce(round(avg(rating)::numeric, 2), 0)::float AS average,
               coalesce(sum(case when on_chain then 1 else 0 end), 0)::int AS "onChain"
        FROM feedback
        WHERE NOT hidden
      `,
      query<RecentRow>`
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

    // An empty table returns a row of zeroes rather than no row, but
    // defaulting here keeps the response shape stable even if that changes.
    const summary = summaryRows[0] ?? {
      count: 0,
      average: 0,
      onChain: 0,
    };
    return { summary, recent: recentRows };
  } catch (error) {
    throw storageUnavailable(error, 'feedback.read', STORAGE_MESSAGE);
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
    throw storageUnavailable(error, 'feedback.write', STORAGE_MESSAGE);
  }
}
