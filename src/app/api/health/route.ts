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

import { contractsConfigured } from '@/config/contract';
import { activeProfile } from '@/config/network';
import { log } from '@/lib/api/logger';
import { json, route } from '@/lib/api/route';
import { soroban } from '@/lib/stellar/rpc';
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
  // Probed together: neither depends on the other, so the endpoint answers in
  // the time of the slower one rather than the sum.
  const [database, chain] = await Promise.all([
    checkDatabase(requestId),
    checkChain(requestId),
  ]);

  // Every check contributes to one verdict, so adding a dependency later means
  // adding it to this list rather than touching the response shape.
  const degraded = [database, chain].some((check) => check.status !== 'ok');

  return json(
    {
      status: degraded ? 'degraded' : 'ok',
      requestId,
      // Which chain this build actually talks to. A deploy pointed at the wrong
      // network is otherwise invisible to a monitor: Postgres is reachable, so
      // a database-only probe reports a perfectly healthy, wrong application.
      network: activeProfile.network,
      contractsConfigured,
      uptimeSeconds: Math.round(process.uptime()),
      checks: { database, chain },
    },
    {
      status: degraded ? 503 : 200,
      headers: { 'cache-control': 'no-store' },
    },
  );
});

/**
 * Confirm the Soroban RPC for the configured network is reachable and is that
 * network.
 *
 * `getNetwork` returns the RPC's own passphrase, so this catches the failure a
 * database probe cannot see: a build whose environment points it at the wrong
 * chain. A mismatch is reported as an error even though the endpoint answered,
 * because serving mainnet traffic from a testnet build is not a degraded
 * service, it is the wrong service.
 */
async function checkChain(requestId: string): Promise<CheckResult> {
  const startedAt = Date.now();

  try {
    const { passphrase } = await withTimeout(soroban.getNetwork(), CHECK_TIMEOUT_MS);

    if (passphrase !== activeProfile.networkPassphrase) {
      log('error', 'health.chain.mismatch', { requestId, expected: activeProfile.network });
      return { status: 'error', latencyMs: 0, error: CHECK_ERROR };
    }

    return { status: 'ok', latencyMs: Date.now() - startedAt };
  } catch (err) {
    log('error', 'health.chain', { requestId, err });
    return { status: 'error', latencyMs: 0, error: CHECK_ERROR };
  }
}

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
