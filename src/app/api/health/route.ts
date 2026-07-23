/**
 * Readiness probe for uptime monitors, load balancers and deploy gates.
 *
 * `GET /api/health` reports whether this instance can actually serve traffic,
 * not merely whether the process is listening: it round-trips a trivial query
 * to Postgres and reports the latency. The response is `200` while every check
 * passes and `503` as soon as one fails, so a monitor polling the status code
 * alone alarms correctly without parsing the body.
 *
 * Safe to expose publicly. The body carries no environment variables, versions,
 * hostnames, region names or dependency URLs — nothing that helps fingerprint
 * the deployment. A failing check reports a fixed generic string; the real
 * driver error (which can embed the connection string) is only ever written to
 * the server-side log, keyed by the same `requestId` returned to the caller.
 */

import { log } from '@/lib/api/logger';
import { json, route } from '@/lib/api/route';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Longest a dependency probe may run before it is declared unhealthy. */
const CHECK_TIMEOUT_MS = 2_000;

/**
 * The only failure detail a client is given.
 *
 * Deliberately says nothing about which layer broke or why — an attacker learns
 * nothing from it, and an operator has the log line instead.
 */
const CHECK_ERROR = 'unavailable';

/** Outcome of a single dependency probe. */
interface CheckResult {
  status: 'ok' | 'error';
  /** Round-trip time in milliseconds; `0` when the check never completed. */
  latencyMs: number;
  error?: string;
}

export const GET = route('health', async (_request, { requestId }) => {
  const database = await checkDatabase(requestId);

  // Every check contributes to one verdict, so adding a dependency later means
  // adding it to this list rather than touching the response shape.
  const degraded = [database].some((check) => check.status !== 'ok');

  return json(
    {
      status: degraded ? 'degraded' : 'ok',
      requestId,
      uptimeSeconds: Math.round(process.uptime()),
      checks: { database },
    },
    {
      status: degraded ? 503 : 200,
      headers: { 'cache-control': 'no-store' },
    },
  );
});

/**
 * Time a `SELECT 1` against Postgres, degrading rather than throwing.
 *
 * Nothing here is allowed to escape: a missing `DATABASE_URL`, a rejected
 * connection and a socket that hangs past the timeout all resolve to the same
 * client-facing `error` result, and the underlying cause is logged instead.
 */
async function checkDatabase(requestId: string): Promise<CheckResult> {
  const startedAt = Date.now();

  try {
    await withTimeout(probeDatabase(), CHECK_TIMEOUT_MS);
    return { status: 'ok', latencyMs: Date.now() - startedAt };
  } catch (err) {
    log('error', 'health.database', { requestId, err });
    return { status: 'error', latencyMs: 0, error: CHECK_ERROR };
  }
}

/**
 * Issue the cheapest query that still proves the connection works.
 *
 * `sql()` throws synchronously when `DATABASE_URL` is unset; keeping the call
 * inside this `async` function turns that into a rejection the caller's
 * `try`/`catch` can handle alongside every other failure mode.
 */
async function probeDatabase(): Promise<void> {
  const db = sql();
  await db`SELECT 1`;
}

/**
 * Reject with a timeout error if `work` has not settled within `ms`.
 *
 * The timer is always cleared once the race is decided, so a probe that
 * finishes quickly cannot leave a pending timeout holding the event loop — and
 * therefore the serverless function — open until it fires.
 */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Health check timed out after ${ms}ms.`)), ms);
  });

  return Promise.race([work, expiry]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
