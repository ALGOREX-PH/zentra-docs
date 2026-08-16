/**
 * Account provisioning — minting throwaway testnet accounts and funding them.
 *
 * This is the first phase of a run and the one most likely to be the thing that
 * limits it. Friendbot is a free faucet with no SLA: it throttles, it stalls,
 * and under a burst it will hang up mid-connection. So the contract of this
 * module is that a *partial* result is the normal outcome, not an error case.
 * `provisionAccounts` resolves for every input, returning the accounts that made
 * it alongside one `AttemptFailure` per account that did not, and it never
 * throws away the survivors because a sibling failed. A run of 200 that funds
 * 187 is a run of 187, and `FundingOutcome` is shaped to say exactly that.
 *
 * Three decisions carry most of the weight here.
 *
 * 1. **Secrets never leave memory.** A minted seed lives in exactly one place:
 *    the `secret` field of a returned `FundedAccount`. Nothing in this file
 *    logs, prints, or writes one, no error message interpolates a URL (a
 *    Friendbot request carries an `addr` query string, and echoing URLs into
 *    messages is how query strings end up in reports), and every message taken
 *    from a response body or a caught error passes through `sanitise`, which
 *    redacts anything shaped like a Stellar seed before it can be returned. The
 *    keypair-generation `catch` discards the thrown value entirely, on the same
 *    reasoning `src/lib/api/sponsor.ts` uses: a failure inside key handling is
 *    the one error most likely to have captured key material.
 *
 * 2. **Retry only what retrying can fix.** 429, 5xx and a dropped or timed-out
 *    connection are the faucet being busy — backoff is the correct response.
 *    Any other 4xx is the faucet refusing this specific request, and repeating
 *    it just spends the run's time budget arriving at the same answer, while
 *    adding load that makes the retryable failures worse for every other
 *    account in flight.
 *
 * 3. **Everything slow is bounded.** Every request runs under an
 *    `AbortSignal` armed with `timeoutMs`, because the failure mode that ruins
 *    a load test is not a request that fails, it is one that neither fails nor
 *    succeeds while holding a concurrency slot the rest of the batch is waiting
 *    for.
 *
 * `fetch` and the delay function are injected so the whole module is exercisable
 * with no network and no real waiting — see `accounts.test.ts`. Plain Node: this
 * runs under `bun`/`tsx` and imports nothing from `src/`.
 */

import { Keypair } from '@stellar/stellar-sdk';

import type { AttemptFailure, FundedAccount, FundingOutcome, LoadTestConfig } from './types';

/**
 * The part of a `Response` this module actually reads.
 *
 * Narrow on purpose. The real `fetch` satisfies it structurally, so the default
 * needs no adapter, and a test double is three fields rather than a mock of the
 * whole DOM interface.
 */
export type FriendbotResponse = Pick<Response, 'ok' | 'status'> & { text(): Promise<string> };

/** The injectable shape of `fetch`. The signal is always supplied. */
export type FetchLike = (url: string, init: { signal: AbortSignal }) => Promise<FriendbotResponse>;

/** The injectable shape of the backoff delay. */
export type SleepLike = (ms: number) => Promise<void>;

/**
 * Provisioning knobs.
 *
 * The first four are taken straight from `LoadTestConfig` rather than restated,
 * so `run.ts` can hand its config over unchanged and the two definitions cannot
 * drift. The retry policy is local because it is this phase's concern alone —
 * no other stage talks to Friendbot.
 */
export interface ProvisionOptions
  extends Pick<LoadTestConfig, 'accounts' | 'concurrency' | 'friendbotUrl' | 'timeoutMs'> {
  /** Total attempts per account, the first try included. */
  maxAttempts?: number;
  /** Backoff ceiling for the first retry; doubles from there. */
  baseBackoffMs?: number;
  /** Cap on the doubling, so a long retry chain cannot grow without bound. */
  maxBackoffMs?: number;
}

/**
 * Collaborators, each defaulting to the real thing.
 *
 * This is the difference between a module that can be tested and one that can
 * only be run: with these four injected, every branch below — throttling,
 * timeout, jitter, elapsed time — is reachable in milliseconds without touching
 * the network.
 */
export interface ProvisionDeps {
  fetch?: FetchLike;
  sleep?: SleepLike;
  /** Jitter source. Injected so a test can pin the delay it asserts on. */
  random?: () => number;
  /** Monotonic clock in milliseconds. */
  now?: () => number;
}

/**
 * Four attempts spans roughly a second and a half of backoff at the defaults —
 * long enough to ride out a Friendbot throttle window, short enough that a
 * genuinely dead faucet fails the run instead of hanging it.
 */
export const DEFAULT_MAX_ATTEMPTS = 4;
export const DEFAULT_BASE_BACKOFF_MS = 250;
export const DEFAULT_MAX_BACKOFF_MS = 8_000;

/** Ceiling on any message this module returns, so one huge body cannot bloat a report. */
export const MAX_MESSAGE_CHARS = 300;

/** What replaces anything seed-shaped found in text on its way out of this module. */
export const REDACTED = '[redacted]';

/**
 * Recorded as the `publicKey` of a `keypair`-stage failure.
 *
 * An account whose keypair never generated has no address, and `AttemptFailure`
 * requires a string. A sentinel is the honest answer; a fabricated `G…` would
 * be a fake address in a report, and this harness's whole premise is that its
 * numbers are not invented.
 */
export const UNKNOWN_PUBLIC_KEY = 'unknown';

/** A Stellar secret seed: strkey base32, 'S' plus 55 characters. */
const SECRET_SEED_PATTERN = /S[A-Z2-7]{55}/g;

/**
 * Body fragments meaning "this account is already funded".
 *
 * Worth special-casing because it is what a *successful* attempt looks like
 * after a timeout: attempt one reached the faucet and created the account, we
 * gave up waiting for the response, and attempt two is told the work is already
 * done. Treating that 400 as terminal would discard an account that is funded
 * and ready to sign — the same call `src/lib/stellar/account.ts` makes for the
 * UI's fund button, for the same reason.
 */
const ALREADY_FUNDED_FRAGMENTS = ['op_already_exists', 'alreadyexist'];

/** The resolved, clamped policy a single account is provisioned under. */
interface Policy {
  friendbotUrl: string;
  timeoutMs: number;
  maxAttempts: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
}

/** The resolved collaborators, with every default already applied. */
interface Io {
  fetch: FetchLike;
  sleep: SleepLike;
  random: () => number;
  now: () => number;
}

/** One account's terminal state: funded, or failed with a reason. */
type AccountResult = { ok: true; account: FundedAccount } | { ok: false; failure: AttemptFailure };

/** One request's verdict, already classified for the retry loop. */
type AttemptOutcome =
  | { kind: 'funded'; ledger: number | null }
  | { kind: 'retryable'; message: string }
  | { kind: 'terminal'; message: string };

/**
 * Create and fund `options.accounts` throwaway testnet accounts.
 *
 * Resolves for every input. The returned `funded` array holds the accounts that
 * are ready to sign; `failures` holds one entry per account that is not, tagged
 * `keypair` or `funding` depending on how far it got. Both are in request order,
 * so two runs over the same fixtures produce the same report regardless of how
 * the pool happened to interleave.
 */
export async function provisionAccounts(
  options: ProvisionOptions,
  deps: ProvisionDeps = {},
): Promise<FundingOutcome> {
  const total = Math.max(0, Math.floor(options.accounts));
  if (total === 0) return { funded: [], failures: [] };

  const policy = resolvePolicy(options);
  const io: Io = {
    // Wrapped rather than passed by reference: `globalThis.fetch` is unbound and
    // some runtimes reject it being called detached from its receiver.
    fetch: deps.fetch ?? ((url, init) => fetch(url, init)),
    sleep: deps.sleep ?? realSleep,
    random: deps.random ?? Math.random,
    // `performance.now` over `Date.now` because this measures a duration: a
    // wall-clock correction mid-run would otherwise be able to report an account
    // as having taken negative time to fund.
    now: deps.now ?? (() => performance.now()),
  };

  // Every index is written exactly once, by whichever worker claimed it, so the
  // array is fully populated by the time `Promise.all` settles.
  const results = new Array<AccountResult>(total);

  // A shared cursor rather than pre-sliced ranges: accounts do not cost the same
  // — one that retries three times takes far longer than one that funds on the
  // first try — and fixed slices would leave workers idle while a single unlucky
  // slice finished alone.
  let cursor = 0;

  // Bounded because Friendbot throttles, and capped at `total` so asking for
  // three accounts at a concurrency of fifty does not spawn forty-seven workers
  // whose only job is to observe an exhausted cursor.
  const workers = Math.min(Math.max(1, Math.floor(options.concurrency)), total);

  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (;;) {
        // Claim-then-check, with no `await` between the read and the increment.
        // JavaScript's single-threaded turn makes that pair indivisible, so two
        // workers can never claim the same index.
        const index = cursor;
        cursor += 1;
        if (index >= total) return;

        results[index] = await provisionOne(policy, io);
      }
    }),
  );

  const funded: FundedAccount[] = [];
  const failures: AttemptFailure[] = [];
  for (const result of results) {
    if (result.ok) funded.push(result.account);
    else failures.push(result.failure);
  }

  return { funded, failures };
}

/**
 * Mint one keypair and fund it, retrying the retryable.
 *
 * The clock starts before generation because `FundedAccount.fundingMs` is
 * documented as the cost of *creating and funding* the account — which means
 * backoff sleeps count too. They are part of what the account cost the run, and
 * hiding them would make a throttled run look as fast as a clean one.
 */
async function provisionOne(policy: Policy, io: Io): Promise<AccountResult> {
  const startedAt = io.now();

  let publicKey: string;
  let secret: string;
  try {
    const keypair = Keypair.random();
    publicKey = keypair.publicKey();
    secret = keypair.secret();
  } catch {
    // The thrown value is discarded, not sanitised. This is the one catch in the
    // file where the error could plausibly carry raw key material in a message
    // or a stack frame, and no diagnostic is worth the chance of putting a seed
    // into a returned string. A generation failure means the runtime has no
    // usable entropy, which the fixed message describes adequately.
    return {
      ok: false,
      failure: {
        publicKey: UNKNOWN_PUBLIC_KEY,
        stage: 'keypair',
        message: 'Keypair generation failed.',
      },
    };
  }

  // Built once. A URL that will not parse is a configuration mistake, and no
  // number of retries makes a malformed endpoint parse on the fourth try.
  const url = friendbotRequestUrl(policy.friendbotUrl, publicKey);
  if (url === null) {
    return fundingFailure(publicKey, 'Configured Friendbot URL is not a valid absolute URL.');
  }

  let lastRetryable = 'no response was recorded';

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    const outcome = await attemptFunding(url, policy.timeoutMs, io);

    if (outcome.kind === 'funded') {
      return {
        ok: true,
        account: {
          publicKey,
          secret,
          fundedAtLedger: outcome.ledger,
          fundingMs: elapsedMs(startedAt, io.now()),
        },
      };
    }

    if (outcome.kind === 'terminal') {
      return fundingFailure(publicKey, outcome.message);
    }

    lastRetryable = outcome.message;

    // No sleep after the final attempt — there is nothing left to wait for, and
    // a trailing backoff would just add latency to a failure already decided.
    if (attempt < policy.maxAttempts) {
      await io.sleep(backoffMs(attempt, policy, io.random));
    }
  }

  return fundingFailure(
    publicKey,
    `Friendbot did not fund the account after ${policy.maxAttempts} attempts: ${lastRetryable}`,
  );
}

/**
 * One Friendbot request, under a timeout, classified rather than thrown.
 *
 * Returning a verdict instead of throwing keeps the retry loop above readable:
 * the decision of whether a failure is worth repeating belongs next to the
 * status code that produced it, not in a `catch` several frames away trying to
 * reconstruct it from an error shape.
 */
async function attemptFunding(url: string, timeoutMs: number, io: Io): Promise<AttemptOutcome> {
  const controller = new AbortController();

  // A local flag, not an inspection of the error. An `AbortError` says the
  // request was cancelled but not by whom — and "we ran out of patience" and
  // "the caller cancelled" are different facts. Recording ours directly means
  // the classification is never a guess.
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await io.fetch(url, { signal: controller.signal });
    const body = await readBody(response);

    // A 2xx means the faucet accepted and executed the create; the account
    // exists regardless of what the body says or whether it was readable at all.
    if (response.ok) return { kind: 'funded', ledger: extractLedger(body) };

    if (isAlreadyFunded(body)) return { kind: 'funded', ledger: null };

    const message = `Friendbot answered ${response.status}${bodyDetail(body)}`;
    return isRetryableStatus(response.status)
      ? { kind: 'retryable', message }
      : { kind: 'terminal', message };
  } catch (error) {
    if (timedOut) {
      return { kind: 'retryable', message: `Friendbot did not answer within ${timeoutMs}ms` };
    }

    // Everything reaching here is transport: DNS, a refused or reset connection,
    // a TLS handshake that failed. All of it is the network rather than the
    // request, and all of it is worth one more try. The URL is deliberately not
    // part of the message — see the secret-handling note at the top of the file.
    return { kind: 'retryable', message: `Friendbot request failed: ${describeError(error)}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read the body as text, or an empty string.
 *
 * Both uses of the body — the ledger and the already-funded check — need it as
 * text, so one read serves both and no second consumption of a used stream can
 * happen. A read that fails is never allowed to change the verdict: the status
 * line has already told us whether the account was created, and downgrading a
 * 2xx over an unreadable body would report a funded account as a failure.
 */
async function readBody(response: FriendbotResponse): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/**
 * The ledger Friendbot says the funding landed in, or null.
 *
 * Only the top-level `ledger` field is trusted, and only when it parses to a
 * positive integer. Friendbot's body is a Horizon submission result whose exact
 * shape varies by deployment, and some builds omit the field entirely. Null is
 * the correct answer in every one of those cases — `LoadTestReport` can say "not
 * reported", and a derived or guessed ledger number in a published result would
 * be worse than no number at all.
 */
function extractLedger(body: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;

  const raw = (parsed as { ledger?: unknown }).ledger;
  const ledger = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;

  return Number.isInteger(ledger) && ledger > 0 ? ledger : null;
}

/** Whether a non-2xx body is the faucet reporting the account already exists. */
function isAlreadyFunded(body: string): boolean {
  const haystack = body.toLowerCase();
  return ALREADY_FUNDED_FRAGMENTS.some((fragment) => haystack.includes(fragment));
}

/**
 * Whether a status is worth retrying.
 *
 * 429 is the throttle this whole retry policy exists for, and 5xx is the faucet
 * being unwell rather than us being wrong. 408 joins them because it is the
 * server reporting the same event our own `AbortSignal` reports — a request that
 * ran out of time — and the two should not be classified differently just
 * because one was noticed at the other end of the wire. Every other 4xx is a
 * verdict on this request, and repeating it changes nothing.
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

/**
 * Exponential backoff with jitter, halfway rather than full.
 *
 * The exponent spreads retries out as the faucet stays busy; the jitter
 * decorrelates a batch that hit the throttle together and would otherwise
 * retry in lockstep, re-creating the burst that caused the throttle. Only the
 * upper half of the window is randomised — full jitter can draw a delay near
 * zero, which for a synchronised batch means several accounts retrying
 * immediately and the thundering herd surviving the mechanism meant to break it.
 */
function backoffMs(attempt: number, policy: Policy, random: () => number): number {
  const ceiling = Math.min(policy.maxBackoffMs, policy.baseBackoffMs * 2 ** (attempt - 1));
  const half = ceiling / 2;
  return Math.round(half + random() * half);
}

/**
 * The request URL for one address.
 *
 * `searchParams.set` rather than string concatenation: it encodes the value, and
 * `set` replaces any `addr` a configured base already carried instead of
 * appending a second one that the faucet would be free to read either of.
 * Returns null for a base that will not parse, so the caller can report a
 * configuration error rather than have a `TypeError` surface as a network fault.
 */
function friendbotRequestUrl(base: string, publicKey: string): string | null {
  try {
    const url = new URL(base);
    url.searchParams.set('addr', publicKey);
    return url.toString();
  } catch {
    return null;
  }
}

/** A `funding`-stage failure, with the message sanitised on the way out. */
function fundingFailure(publicKey: string, message: string): AccountResult {
  return { ok: false, failure: { publicKey, stage: 'funding', message: sanitise(message) } };
}

/** The body appended to a status message, when there is anything to append. */
function bodyDetail(body: string): string {
  const detail = sanitise(body);
  return detail.length > 0 ? `: ${detail}` : '';
}

/** The most useful thing that can safely be said about a caught transport error. */
function describeError(error: unknown): string {
  if (error instanceof Error) return sanitise(error.message) || error.name;
  return sanitise(String(error)) || 'unknown error';
}

/**
 * Make text safe to return.
 *
 * Redaction runs before truncation on purpose: truncating first could cut a seed
 * in half and leave the surviving fragment in the message, whereas redacting
 * first guarantees there is no seed left to cut. Newlines are folded because
 * these messages end up in single-line report tables, and the length cap keeps a
 * faucet that answers with an HTML error page from filling the output.
 */
function sanitise(text: string): string {
  return text
    .replace(SECRET_SEED_PATTERN, REDACTED)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MESSAGE_CHARS);
}

/** Clamped and floored policy, so a nonsensical config cannot produce a stuck run. */
function resolvePolicy(options: ProvisionOptions): Policy {
  const baseBackoffMs = Math.max(0, Math.floor(options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS));

  return {
    friendbotUrl: options.friendbotUrl,
    // At least 1ms: a zero or negative timeout would arm the abort before the
    // request could ever complete, turning every attempt into a timeout.
    timeoutMs: Math.max(1, Math.floor(options.timeoutMs)),
    maxAttempts: Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)),
    baseBackoffMs,
    // Never below the base, so a misconfigured cap cannot invert the window.
    maxBackoffMs: Math.max(
      baseBackoffMs,
      Math.floor(options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS),
    ),
  };
}

/** Whole milliseconds, never negative. */
function elapsedMs(from: number, to: number): number {
  return Math.max(0, Math.round(to - from));
}

/** The real delay, used unless a test injects its own. */
function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
