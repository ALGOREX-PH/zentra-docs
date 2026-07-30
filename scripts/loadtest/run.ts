/**
 * Load-test CLI entry: parse a run, refuse it if it is wrong, drive it, report it.
 *
 * ## The one default this file refuses to supply
 *
 * Every knob here defaults to something sensible for testnet except the two
 * contract ids, which have no default at all. Defaulting them to the ids in
 * `src/config/contract.ts` would work perfectly and be a serious bug: `/metrics`
 * derives its action and distinct-wallet counts from the live action-log
 * instance, and the project presents those counts as adoption — `docs/BELT-CHECKLIST.md`
 * reads them as progress toward 50 real users. A load run against that instance
 * writes hundreds of synthetic authors into that number, permanently, with no
 * way to subtract them again. So the ids are required, the error says why, and
 * `scripts/loadtest/deploy-isolated.sh` exists to hand you throwaway ones.
 *
 * ## Secrets
 *
 * This file holds `FundedAccount[]`, and `FundedAccount.secret` is a real secret
 * seed. The only field of an account read anywhere below is `publicKey`. Nothing
 * here serialises an account, spreads one into a log line, or stringifies one at
 * any verbosity — `--verbose` prints public keys only. `LoadTestReport` has
 * nowhere to put a secret by construction, which is what makes writing the
 * report safe rather than merely careful.
 *
 * ## Failure is a result, not an abort
 *
 * A run that funds 40 of 50 accounts and lands 31 records is a measurement, and
 * the interesting part is *where* the other 19 died. So every phase degrades:
 * unreadable counts become `null`, a failed attempt becomes a `RecordAttempt`
 * with a stage, and the report is written either way. The exit code is the only
 * thing that collapses to a boolean, because CI needs one bit: non-zero when not
 * a single record succeeded, zero when at least one did.
 *
 * ## Sibling modules
 *
 * The orchestration lives here; the work does not. This file imports and does
 * not implement: `./accounts` (provisioning + Friendbot funding), `./driver`
 * (one `record()` invocation per account, plus the capped reads), `./report`
 * (aggregation + Markdown). The concurrency pool is here because bounding the
 * run is the orchestrator's job — the driver drives one account and knows
 * nothing about the other forty-nine.
 */

import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { Networks } from '@stellar/stellar-sdk';

import { provisionAccounts } from './accounts';
import { countDistinctAuthorsLowerBound, readActionLogCount, recordOnce } from './driver';
import { buildReport, renderMarkdown } from './report';
import type {
  AttemptFailure,
  FundedAccount,
  FundingOutcome,
  LoadTestConfig,
  LoadTestReport,
  RecordAttempt,
} from './types';

/**
 * Testnet defaults. The contract ids are deliberately absent — see the header.
 *
 * The passphrase comes from the SDK rather than being typed out, for the same
 * reason `src/config/network.ts` does it: a hand-typed passphrase that differs
 * by one character produces signatures the network rejects with an error that
 * names neither the passphrase nor the network.
 */
const DEFAULTS = {
  accounts: 10,
  concurrency: 5,
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: Networks.TESTNET,
  friendbotUrl: 'https://friendbot.stellar.org',
  message: 'zentra load test',
  timeoutMs: 60_000,
  /**
   * Inside the already-gitignored `/out/`, so a report can never be committed by
   * accident. The harness is not allowed to edit `.gitignore` to make room for
   * itself, so it lives somewhere already covered instead.
   */
  outDir: 'out/loadtest',
} as const;

/**
 * Ceiling on accounts. Not a performance limit — a typo limit. `--accounts 5000`
 * is 5000 Friendbot calls and 5000 transactions against a shared public testnet,
 * which is closer to abuse than to measurement.
 */
const MAX_ACCOUNTS = 500;

/**
 * Ceiling on in-flight operations. Friendbot rate-limits by source IP and RPC
 * providers throttle; past roughly this many lanes the numbers stop describing
 * the contracts and start describing the throttle, which is the one result this
 * harness cannot use.
 */
const MAX_CONCURRENCY = 25;

const MIN_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 300_000;

/**
 * Mirrors `MAX_MESSAGE_LEN` in `contracts/zentra-action-log/src/lib.rs`.
 *
 * Checked in bytes, not characters, because the contract checks
 * `soroban_sdk::String::len()` — a UTF-8 byte count. An ASCII message makes the
 * two identical; one emoji makes a 60-"character" message 200+ bytes and the
 * contract returns `MessageTooLong` after every account has been funded.
 */
const MAX_MESSAGE_BYTES = 200;

/**
 * Mirrors `MAX_RECENT` in the action-log contract: `get_recent` clamps its own
 * limit to 20 regardless of what you ask for. Every distinct-author number this
 * harness reports is therefore a floor, and the notes have to say so.
 */
const GET_RECENT_CAP = 20;

/** `C` plus 55 base32 characters (RFC 4648 alphabet, no padding). */
const CONTRACT_ID_PATTERN = /^C[A-Z2-7]{55}$/;

/**
 * Grace added on top of `timeoutMs` for this file's own watchdog.
 *
 * The driver owns `timeoutMs` and classifies what it times out on, which is the
 * whole point of `FailureStage`. The watchdog exists only for the case where the
 * driver itself wedges and never settles — so it must lose the race in normal
 * operation, hence the margin. When it does fire, the failure it synthesises
 * says the driver never returned rather than guessing at a network stage.
 */
const WATCHDOG_GRACE_MS = 15_000;

const EXIT_OK = 0;
const EXIT_NO_SUCCESS = 1;
const EXIT_BAD_CONFIG = 2;

/** Every flag, and the environment variable it falls back to. */
const OPTIONS = {
  accounts: 'LOADTEST_ACCOUNTS',
  concurrency: 'LOADTEST_CONCURRENCY',
  'action-log': 'LOADTEST_ACTION_LOG_ID',
  reputation: 'LOADTEST_REPUTATION_ID',
  'rpc-url': 'LOADTEST_RPC_URL',
  'network-passphrase': 'LOADTEST_NETWORK_PASSPHRASE',
  'friendbot-url': 'LOADTEST_FRIENDBOT_URL',
  message: 'LOADTEST_MESSAGE',
  'timeout-ms': 'LOADTEST_TIMEOUT_MS',
  out: 'LOADTEST_OUT_DIR',
} as const;

type OptionName = keyof typeof OPTIONS;
type OptionValues = Partial<Record<OptionName, string>>;
type Env = Record<string, string | undefined>;

interface ParsedArgs {
  values: OptionValues;
  verbose: boolean;
  help: boolean;
  problems: string[];
}

const HELP = `zentra load test

  bun scripts/loadtest/run.ts --action-log C... --reputation C... [options]

Required — no defaults, on purpose:
  --action-log <C...>            Action-log instance to drive.
  --reputation <C...>            Reputation instance it bumps.

  Both must be throwaway instances deployed for this run
  (scripts/loadtest/deploy-isolated.sh). Pointing this at the ids in
  src/config/contract.ts writes synthetic authors into the counts /metrics
  presents as adoption, and nothing can remove them afterwards.

Options (flag, env var, default):
  --accounts <n>                LOADTEST_ACCOUNTS              ${DEFAULTS.accounts}   (1-${MAX_ACCOUNTS})
  --concurrency <n>             LOADTEST_CONCURRENCY           ${DEFAULTS.concurrency}    (1-${MAX_CONCURRENCY})
  --message <text>              LOADTEST_MESSAGE               "${DEFAULTS.message}"
  --timeout-ms <n>              LOADTEST_TIMEOUT_MS            ${DEFAULTS.timeoutMs}  (${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS})
  --rpc-url <url>               LOADTEST_RPC_URL               ${DEFAULTS.rpcUrl}
  --friendbot-url <url>         LOADTEST_FRIENDBOT_URL         ${DEFAULTS.friendbotUrl}
  --network-passphrase <text>   LOADTEST_NETWORK_PASSPHRASE    the SDK's testnet passphrase
  --out <dir>                   LOADTEST_OUT_DIR               ${DEFAULTS.outDir}
  --verbose                                                    per-attempt lines (public keys only)
  --help

Exit codes: ${EXIT_OK} at least one record landed · ${EXIT_NO_SUCCESS} none did · ${EXIT_BAD_CONFIG} the run was refused before spending anything.

docs/LOADTEST.md has the framing this output must be read with.
`;

function isOptionName(name: string): name is OptionName {
  return Object.prototype.hasOwnProperty.call(OPTIONS, name);
}

/**
 * Parse `--flag value` and `--flag=value`.
 *
 * An unknown flag is a hard problem rather than a warning: `--acounts 400`
 * silently running 10 accounts is worse than not running at all, because the
 * report would be honest about a run nobody asked for.
 */
function parseArgv(argv: readonly string[]): ParsedArgs {
  const values: OptionValues = {};
  const problems: string[] = [];
  let verbose = false;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--verbose') {
      verbose = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      problems.push(`unexpected argument '${arg}' — every option is a --flag`);
      continue;
    }

    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);

    if (!isOptionName(name)) {
      problems.push(`unknown flag '--${name}' — run with --help for the list`);
      // Swallow the value that presumably followed it, so one typo produces one
      // complaint instead of also reporting its argument as a stray token.
      if (eq === -1 && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        i += 1;
      }
      continue;
    }

    if (eq === -1) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        problems.push(`--${name} needs a value`);
        continue;
      }
      values[name] = next;
      i += 1;
    } else {
      values[name] = arg.slice(eq + 1);
    }
  }

  return { values, verbose, help, problems };
}

/** Flag beats environment beats default. Blank env values count as absent. */
function resolveOption(name: OptionName, values: OptionValues, env: Env): string | undefined {
  const flag = values[name];
  if (flag !== undefined) return flag;
  const raw = env[OPTIONS[name]];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Whole numbers only, and rejected rather than coerced.
 *
 * `Number.parseInt('12 accounts')` is 12 and `Number('')` is 0; both are ways to
 * run something other than what was asked for. On a bad value the default is
 * returned so validation can go on and collect every problem in one pass — the
 * recorded problem is what stops the run.
 */
function toInteger(raw: string, label: string, fallback: number, problems: string[]): number {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    problems.push(`${label} must be a whole number, got '${raw}'`);
    return fallback;
  }
  return Number.parseInt(trimmed, 10);
}

/** http/https only: a `file:` or `mailto:` url parses cleanly and is nonsense here. */
function urlProblem(label: string, raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return `${label} is not a URL: '${raw}'`;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `${label} must be http or https, got '${parsed.protocol}' in '${raw}'`;
  }
  return null;
}

function contractIdProblem(label: string, raw: string): string | null {
  if (CONTRACT_ID_PATTERN.test(raw)) return null;
  if (/^c[a-z2-7]{55}$/.test(raw)) {
    return `${label} must be upper-case: '${raw}'`;
  }
  return (
    `${label} is not a contract id: expected 'C' followed by 55 base32 characters ` +
    `(A-Z, 2-7), got ${raw.length} characters: '${raw}'`
  );
}

interface ResolvedRun {
  config: LoadTestConfig;
  outDir: string;
}

/**
 * Build the config, then check it. Nothing above this line has spent anything;
 * nothing below it can be taken back, which is why the whole surface is
 * validated here rather than discovered one failed transaction at a time.
 */
function resolveRun(values: OptionValues, env: Env): { run: ResolvedRun; problems: string[] } {
  const problems: string[] = [];

  const accountsRaw = resolveOption('accounts', values, env);
  const concurrencyRaw = resolveOption('concurrency', values, env);
  const timeoutRaw = resolveOption('timeout-ms', values, env);
  const actionLogId = resolveOption('action-log', values, env);
  const reputationId = resolveOption('reputation', values, env);

  const config: LoadTestConfig = {
    accounts: accountsRaw === undefined
      ? DEFAULTS.accounts
      : toInteger(accountsRaw, '--accounts', DEFAULTS.accounts, problems),
    concurrency: concurrencyRaw === undefined
      ? DEFAULTS.concurrency
      : toInteger(concurrencyRaw, '--concurrency', DEFAULTS.concurrency, problems),
    rpcUrl: resolveOption('rpc-url', values, env) ?? DEFAULTS.rpcUrl,
    networkPassphrase: resolveOption('network-passphrase', values, env) ?? DEFAULTS.networkPassphrase,
    friendbotUrl: resolveOption('friendbot-url', values, env) ?? DEFAULTS.friendbotUrl,
    actionLogId: actionLogId ?? '',
    reputationId: reputationId ?? '',
    message: resolveOption('message', values, env) ?? DEFAULTS.message,
    timeoutMs: timeoutRaw === undefined
      ? DEFAULTS.timeoutMs
      : toInteger(timeoutRaw, '--timeout-ms', DEFAULTS.timeoutMs, problems),
  };

  // The refusal the header explains. Stated as a consequence, not a rule, so
  // whoever hits it learns why rather than looking for the flag that skips it.
  const MISSING_ID_REASON =
    'give it a throwaway instance from scripts/loadtest/deploy-isolated.sh. There is no default: ' +
    'the live ids in src/config/contract.ts back the action and distinct-wallet counts that ' +
    '/metrics presents as adoption, and synthetic authors written into them cannot be removed.';

  if (actionLogId === undefined) {
    problems.push(`--action-log (or LOADTEST_ACTION_LOG_ID) is required — ${MISSING_ID_REASON}`);
  } else {
    const problem = contractIdProblem('--action-log', actionLogId);
    if (problem !== null) problems.push(problem);
  }

  if (reputationId === undefined) {
    problems.push(`--reputation (or LOADTEST_REPUTATION_ID) is required — ${MISSING_ID_REASON}`);
  } else {
    const problem = contractIdProblem('--reputation', reputationId);
    if (problem !== null) problems.push(problem);
  }

  if (actionLogId !== undefined && actionLogId === reputationId) {
    problems.push('--action-log and --reputation are the same id; they are two separate contracts');
  }

  if (config.accounts < 1 || config.accounts > MAX_ACCOUNTS) {
    problems.push(`--accounts must be between 1 and ${MAX_ACCOUNTS}, got ${config.accounts}`);
  }
  if (config.concurrency < 1 || config.concurrency > MAX_CONCURRENCY) {
    problems.push(
      `--concurrency must be between 1 and ${MAX_CONCURRENCY}, got ${config.concurrency}. ` +
        'Friendbot and the RPC both throttle; past that the run measures the throttle.',
    );
  }
  if (config.timeoutMs < MIN_TIMEOUT_MS || config.timeoutMs > MAX_TIMEOUT_MS) {
    problems.push(
      `--timeout-ms must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}, got ${config.timeoutMs}`,
    );
  }

  const messageBytes = Buffer.byteLength(config.message, 'utf8');
  if (messageBytes === 0) {
    problems.push('--message is empty; the contract rejects that with EmptyMessage');
  } else if (messageBytes > MAX_MESSAGE_BYTES) {
    problems.push(
      `--message is ${messageBytes} bytes, over the contract's ${MAX_MESSAGE_BYTES}-byte limit ` +
        '(the contract counts UTF-8 bytes, not characters, so non-ASCII text costs more than it looks)',
    );
  }

  for (const [label, raw] of [
    ['--rpc-url', config.rpcUrl],
    ['--friendbot-url', config.friendbotUrl],
  ] as const) {
    const problem = urlProblem(label, raw);
    if (problem !== null) problems.push(problem);
  }

  if (config.networkPassphrase.trim() === '') {
    problems.push('--network-passphrase is empty; signatures would be rejected by every network');
  }

  const outDir = path.resolve(resolveOption('out', values, env) ?? DEFAULTS.outDir);

  return { run: { config, outDir }, problems };
}

/**
 * Run `worker` over `items` with at most `limit` in flight.
 *
 * Lanes pull from a shared cursor rather than the array being pre-sliced into
 * chunks, so a single slow attempt delays one lane instead of stalling a whole
 * chunk and flattening the concurrency the run is supposed to be measuring.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const lane = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  };

  const lanes = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: lanes }, () => lane()));
  return results;
}

/** Resolves to the promise's value, or rejects once `ms` has passed. */
function withWatchdog<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const alarm = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not settle within ${ms} ms`)), ms);
  });
  return Promise.race([promise, alarm]).finally(() => clearTimeout(timer));
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

/**
 * Read a count, degrading to `null`.
 *
 * `LoadTestReport` models unreadable counts as `null` rather than 0 because the
 * two mean opposite things: 0 is a measurement, `null` is the absence of one.
 * The read helper may signal either by returning `null` or by throwing; both
 * arrive here as `null` plus a note.
 */
async function safeRead(
  label: string,
  read: () => Promise<number | null>,
  timeoutMs: number,
  notes: string[],
): Promise<number | null> {
  try {
    return await withWatchdog(read(), timeoutMs, label);
  } catch (cause) {
    notes.push(`${label} could not be read: ${errorMessage(cause)}. Reported as null, not as zero.`);
    return null;
  }
}

/**
 * Turn an escaped exception into a failed attempt.
 *
 * The driver classifies its own failures — that is what makes `failuresByStage`
 * worth reading. An exception escaping it was never classified, so it is
 * attributed to `build`, the earliest stage the driver owns, and the message
 * says plainly that the driver threw. The stage is a floor, not a diagnosis;
 * the message is the diagnosis.
 */
function unclassifiedAttempt(publicKey: string, latencyMs: number, cause: unknown): RecordAttempt {
  const failure: AttemptFailure = {
    publicKey,
    stage: 'build',
    message: `driver threw instead of returning an attempt: ${errorMessage(cause)}`,
  };
  return { publicKey, ok: false, latencyMs, txHash: null, ledger: null, failure };
}

interface DriveOutcome {
  attempts: RecordAttempt[];
  /** Attempts the watchdog had to cut short — a caveat, so it is counted. */
  watchdogHits: number;
}

async function driveRecords(
  funded: readonly FundedAccount[],
  config: LoadTestConfig,
  verbose: boolean,
): Promise<DriveOutcome> {
  let watchdogHits = 0;
  const watchdogMs = config.timeoutMs + WATCHDOG_GRACE_MS;

  // The type arguments are written out rather than inferred: they are this file's
  // half of the contract with `./driver`, and stating them here means a driver
  // that returns something other than a `RecordAttempt` is a type error at the
  // call site instead of an `unknown` that spreads through the report.
  const attempts = await mapWithConcurrency<FundedAccount, RecordAttempt>(
    funded,
    config.concurrency,
    async (account) => {
      // `account.publicKey` is the only field of an account this file ever reads.
      const startedAt = Date.now();
      try {
        const attempt = await withWatchdog<RecordAttempt>(
          recordOnce(account, config),
          watchdogMs,
          `record() for ${account.publicKey}`,
        );
        if (verbose) {
          process.stdout.write(
            attempt.ok
              ? `  ok   ${attempt.publicKey} ${attempt.latencyMs}ms ${attempt.txHash ?? '-'}\n`
              : `  fail ${attempt.publicKey} ${attempt.latencyMs}ms ` +
                `${attempt.failure?.stage ?? 'unknown'}: ${attempt.failure?.message ?? ''}\n`,
          );
        }
        return attempt;
      } catch (cause) {
        watchdogHits += 1;
        const attempt = unclassifiedAttempt(account.publicKey, Date.now() - startedAt, cause);
        if (verbose) {
          process.stdout.write(
            `  fail ${attempt.publicKey} ${attempt.latencyMs}ms ${attempt.failure?.message}\n`,
          );
        }
        return attempt;
      }
    },
  );

  return { attempts, watchdogHits };
}

interface NoteInput {
  config: LoadTestConfig;
  funding: FundingOutcome;
  attempts: readonly RecordAttempt[];
  countBefore: number | null;
  countAfter: number | null;
  distinctAuthors: number | null;
  watchdogHits: number;
}

/**
 * Caveats that are true of the run that just happened, and only those.
 *
 * Every note below is gated on something observed. A note that is always
 * printed is a disclaimer people learn to skip; a note that appears because the
 * thing actually occurred is evidence. The single unconditional note is the
 * framing one, which is true of every run by construction and is the note that
 * must never be missing.
 */
function collectNotes(input: NoteInput): string[] {
  const { config, funding, attempts, countBefore, countAfter, distinctAuthors, watchdogHits } = input;
  const notes: string[] = [
    'These accounts are synthetic: created by this harness, funded by Friendbot, used for one ' +
      'transaction and then abandoned. They are not users, and no number in this report is ' +
      'adoption or progress toward the 50-user target.',
  ];

  const succeeded = attempts.filter((attempt) => attempt.ok).length;
  const failed = attempts.length - succeeded;
  const fundingFailures = funding.failures.filter((failure) => failure.stage === 'funding').length;
  const otherProvisionFailures = funding.failures.length - fundingFailures;

  if (countBefore !== null && countBefore > 0) {
    notes.push(
      `The action log already held ${countBefore} entries before this run, so this instance was ` +
        'not deployed for it. Confirm the id is a throwaway from scripts/loadtest/deploy-isolated.sh ' +
        'and not a shared instance whose counts anything else reads.',
    );
  }

  if (fundingFailures > 0) {
    notes.push(
      `${fundingFailures} accounts failed at the funding stage. Friendbot rate-limits by source ` +
        'IP, so this is an infrastructure limit and says nothing about the contracts. Lower ' +
        `--concurrency (was ${config.concurrency}) or rerun later before reading it as a result.`,
    );
  }
  if (otherProvisionFailures > 0) {
    notes.push(
      `${otherProvisionFailures} accounts failed during provisioning at a stage other than funding; ` +
        'see failuresByStage for where.',
    );
  }
  if (funding.funded.length < config.accounts) {
    notes.push(
      `Partial run: ${funding.funded.length} of ${config.accounts} requested accounts were funded, ` +
        'so every total here is over the accounts that survived provisioning, not over the request.',
    );
  }

  if (succeeded === 0) {
    notes.push(
      'No record succeeded, so this run measured nothing about contract throughput. The latency ' +
        'and throughput figures describe an empty set; failuresByStage is the only part worth reading.',
    );
  }

  if (distinctAuthors !== null && succeeded > GET_RECENT_CAP) {
    notes.push(
      `distinctAuthorsSeen is a floor, not a total: get_recent is capped at ${GET_RECENT_CAP} entries ` +
        `by the contract, and this run landed ${succeeded} records, so most of its own authors are ` +
        'not visible to the read that produced the number.',
    );
  }
  if (distinctAuthors !== null && countBefore !== null && countBefore > 0) {
    notes.push(
      `distinctAuthorsSeen was read from the newest ${GET_RECENT_CAP} entries of an instance that ` +
        'already had history, so it may count authors that predate this run as well as its own.',
    );
  }

  if (countBefore === null || countAfter === null) {
    notes.push(
      'The before/after action-log counts are not both readable, so the on-chain delta cannot be ' +
        'compared against the records this run believes it landed.',
    );
  } else {
    const delta = countAfter - countBefore;
    if (delta !== succeeded) {
      notes.push(
        `The action-log count moved by ${delta} while this run recorded ${succeeded} successes. A ` +
          'mismatch means either something else wrote to this instance during the run — so it is ' +
          'not isolated — or an attempt landed on chain after being counted as failed.',
      );
    }
  }

  const confirmFailures = attempts.filter((attempt) => attempt.failure?.stage === 'confirm').length;
  if (confirmFailures > 0) {
    notes.push(
      `${confirmFailures} attempts failed at confirm. Unlike funding failures these are the ` +
        'contracts or the network rejecting real work, which is the part of the run worth investigating.',
    );
  }

  if (watchdogHits > 0) {
    notes.push(
      `${watchdogHits} attempts were cut off by the orchestrator's watchdog after ` +
        `${config.timeoutMs + WATCHDOG_GRACE_MS} ms because the driver never returned. Their stage is ` +
        'recorded as build because they were never classified, not because building is where they failed.',
    );
  }

  if (failed > 0 && succeeded > 0) {
    notes.push(
      `${succeeded} of ${attempts.length} attempts succeeded; the rest are broken down by stage rather ` +
        'than summed, because a Friendbot throttle and a rejected transaction are not the same event.',
    );
  }

  return notes;
}

/** Short, and never a secret: the only account material printed is a count. */
function printSummary(report: LoadTestReport, jsonPath: string, markdownPath: string): void {
  const lines = [
    '',
    `zentra load test — ${report.startedAt} → ${report.finishedAt} (${report.durationMs} ms)`,
    `  action log       ${report.config.actionLogId}`,
    `  reputation       ${report.config.reputationId}`,
    `  accounts         ${report.accountsFunded} funded of ${report.accountsRequested} requested ` +
      `at concurrency ${report.config.concurrency}`,
    `  records          ${report.recordsSucceeded} ok, ${report.recordsFailed} failed, ` +
      `${report.recordsAttempted} attempted`,
    `  throughput       ${report.throughputPerSecond}/s`,
    `  latency          p50 ${report.latency.p50Ms} ms · p95 ${report.latency.p95Ms} ms · ` +
      `p99 ${report.latency.p99Ms} ms · max ${report.latency.maxMs} ms`,
    `  action log count ${report.actionLogCountBefore ?? 'unreadable'} → ` +
      `${report.actionLogCountAfter ?? 'unreadable'}`,
    `  distinct authors ${report.distinctAuthorsSeen ?? 'unreadable'} (floor — get_recent is capped)`,
  ];

  const stages = Object.entries(report.failuresByStage).filter(([, count]) => count > 0);
  if (stages.length > 0) {
    lines.push(`  failures         ${stages.map(([stage, count]) => `${stage}=${count}`).join(' ')}`);
  }

  lines.push('', 'Notes:');
  for (const note of report.notes) lines.push(`  - ${note}`);
  lines.push('', `Wrote ${jsonPath}`, `Wrote ${markdownPath}`, '');

  process.stdout.write(`${lines.join('\n')}\n`);
}

async function main(argv: readonly string[], env: Env): Promise<number> {
  const parsed = parseArgv(argv);

  if (parsed.help) {
    process.stdout.write(HELP);
    return EXIT_OK;
  }

  const { run, problems } = resolveRun(parsed.values, env);
  const allProblems = [...parsed.problems, ...problems];
  if (allProblems.length > 0) {
    process.stderr.write(
      `Refusing to run — nothing has been spent.\n${allProblems.map((p) => `  - ${p}`).join('\n')}\n\n` +
        'Run with --help for the full flag list.\n',
    );
    return EXIT_BAD_CONFIG;
  }

  const { config, outDir } = run;
  const verbose = parsed.verbose;
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const notes: string[] = [];

  process.stdout.write(
    `Driving ${config.accounts} synthetic accounts at concurrency ${config.concurrency} against ` +
      `action log ${config.actionLogId}\n`,
  );

  // Provisioning has no watchdog of its own: it is a phase, not an operation,
  // and the per-account ceiling belongs to `accounts.ts`, which owns the
  // Friendbot call. A phase that throws outright is caught here so the run still
  // produces a report — an empty outcome plus a note, rather than nothing.
  let funding: FundingOutcome = { funded: [], failures: [] };
  try {
    funding = await provisionAccounts(config);
  } catch (cause) {
    notes.push(
      `Provisioning aborted before returning an outcome: ${errorMessage(cause)}. No accounts were ` +
        'usable, so failuresByStage cannot attribute this to a stage — this note is the whole record of it.',
    );
  }
  process.stdout.write(
    `Funded ${funding.funded.length} of ${config.accounts} accounts ` +
      `(${funding.failures.length} failed)\n`,
  );

  // Reads simulate rather than sign, so any funded account serves as the source,
  // and using one of our own keeps the harness from having to be told about an
  // account it does not own. Reading the "before" count here rather than at the
  // top costs nothing: funding creates accounts through Friendbot and never
  // touches the action log, so the count is still the pre-run figure.
  const readSource = funding.funded[0]?.publicKey ?? null;
  if (readSource === null) {
    notes.push(
      'No account was funded, so there was nothing to simulate the contract reads from. Every ' +
        'chain figure is reported as null rather than zero.',
    );
  }

  const countBefore =
    readSource === null
      ? null
      : await safeRead(
          'get_count before the run',
          () => readActionLogCount(config, readSource),
          config.timeoutMs,
          notes,
        );

  const { attempts, watchdogHits } = await driveRecords(funding.funded, config, verbose);

  const countAfter =
    readSource === null
      ? null
      : await safeRead(
          'get_count after the run',
          () => readActionLogCount(config, readSource),
          config.timeoutMs,
          notes,
        );
  const distinctAuthors =
    readSource === null
      ? null
      : await safeRead(
          'distinct authors from get_recent',
          () => countDistinctAuthorsLowerBound(config, readSource),
          config.timeoutMs,
          notes,
        );

  const finishedAtMs = Date.now();

  notes.push(
    ...collectNotes({
      config,
      funding,
      attempts,
      countBefore,
      countAfter,
      distinctAuthors,
      watchdogHits,
    }),
  );

  // Annotated for the same reason as the driver call above: `./report` owns the
  // aggregation, this file owns the assertion that what comes back is a report.
  // Epoch milliseconds rather than ISO strings: `buildReport` derives the ISO
  // stamps from these, so the timestamps and the elapsed time cannot end up
  // describing different runs.
  const report: LoadTestReport = buildReport({
    config,
    startedAtMs,
    finishedAtMs,
    funding,
    attempts,
    reads: {
      actionLogCountBefore: countBefore,
      actionLogCountAfter: countAfter,
      distinctAuthorsSeen: distinctAuthors,
    },
    notes,
  });

  mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'report.json');
  const markdownPath = path.join(outDir, 'report.md');
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(markdownPath, renderMarkdown(report), 'utf8');

  printSummary(report, jsonPath, markdownPath);

  // One bit for CI: did the harness measure anything at all. A partial run is a
  // success by this measure and its shortfall is in the report, not the exit code.
  return report.recordsSucceeded > 0 ? EXIT_OK : EXIT_NO_SUCCESS;
}

// `process.exit` rather than setting `exitCode` and returning: a submission the
// watchdog gave up on can leave an open socket that would keep the event loop
// alive long after the report is written. The report is already on disk here.
void main(process.argv.slice(2), process.env).then(
  (code) => {
    process.exit(code);
  },
  (cause: unknown) => {
    process.stderr.write(`load test failed: ${errorMessage(cause)}\n`);
    process.exit(EXIT_NO_SUCCESS);
  },
);
