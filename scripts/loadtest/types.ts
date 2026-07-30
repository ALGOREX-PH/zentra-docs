/**
 * Shared types for the Zentra load-test harness.
 *
 * ## What this harness is, and is not
 *
 * It creates throwaway testnet accounts and drives them through a real
 * `record()` invocation so the contracts can be measured under concurrency.
 * That is a load test. The accounts are **not users**, and nothing produced here
 * may be reported as adoption: the harness never writes to the `users` signup
 * registry, and it is meant to run against contract instances deployed solely
 * for the run, so synthetic wallets stay out of the chain-derived counts on
 * `/metrics` that the project does present as adoption.
 *
 * `docs/LOADTEST.md` states the same thing for anyone reading the results.
 *
 * ## Secret handling
 *
 * A run mints secret keys for accounts it funds. They exist to sign one
 * transaction and are worthless afterwards, but they must still never leave the
 * process: no secret may appear in a report, a log line, or a committed file.
 * `FundedAccount.secret` is the only field carrying one, and `LoadTestReport`
 * deliberately has nowhere to put it.
 */

/**
 * Where an attempt failed.
 *
 * Kept granular because the interesting question after a run is *which layer*
 * gave out: Friendbot throttling (`funding`) is an infrastructure limit that
 * says nothing about the contracts, whereas `confirm` failures are the contracts
 * or the network rejecting real work. Collapsing those into one error count
 * would hide the distinction that makes the run worth doing.
 */
export type FailureStage = 'keypair' | 'funding' | 'build' | 'sign' | 'submit' | 'confirm';

/** Every stage, in pipeline order — for initialising counters and report tables. */
export const FAILURE_STAGES: readonly FailureStage[] = [
  'keypair',
  'funding',
  'build',
  'sign',
  'submit',
  'confirm',
] as const;

/** One account's failure at one stage, carrying no secret material. */
export interface AttemptFailure {
  /** The account the attempt was for. Public keys are safe to record. */
  publicKey: string;
  stage: FailureStage;
  /** Human-readable cause, already stripped of anything sensitive. */
  message: string;
}

/**
 * A funded, ready-to-sign throwaway account.
 *
 * `secret` is process-local. See the secret-handling note at the top of this file.
 */
export interface FundedAccount {
  publicKey: string;
  secret: string;
  /** Ledger the funding transaction landed in, when Friendbot reported one. */
  fundedAtLedger: number | null;
  /** Wall-clock cost of creating and funding this account. */
  fundingMs: number;
}

/** Result of the funding phase: what survived, and what did not. */
export interface FundingOutcome {
  funded: FundedAccount[];
  failures: AttemptFailure[];
}

/** One account's `record()` invocation, successful or not. */
export interface RecordAttempt {
  publicKey: string;
  ok: boolean;
  /** Build-through-confirm latency. Recorded even for failures. */
  latencyMs: number;
  txHash: string | null;
  ledger: number | null;
  /** Null when `ok` is true. */
  failure: AttemptFailure | null;
}

/**
 * Latency distribution.
 *
 * Percentiles rather than an average alone: a mean hides the tail, and the tail
 * is what a user actually feels when the network is busy.
 */
export interface LatencySummary {
  count: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  meanMs: number;
}

/** Everything a run needs. No defaults live here — `run.ts` owns those. */
export interface LoadTestConfig {
  /** How many throwaway accounts to create and drive. */
  accounts: number;
  /** Maximum in-flight operations. Bounded because Friendbot throttles. */
  concurrency: number;
  rpcUrl: string;
  networkPassphrase: string;
  friendbotUrl: string;
  /** The action-log instance under test — deployed for this run, not the live one. */
  actionLogId: string;
  /** The reputation instance the action log bumps cross-contract. */
  reputationId: string;
  /** Message body each account records. Must satisfy the contract's length bound. */
  message: string;
  /** Per-operation ceiling, so one stuck submission cannot hang the run. */
  timeoutMs: number;
}

/**
 * A finished run.
 *
 * Shaped to be serialised to JSON and rendered to Markdown without further
 * derivation, so the numbers in the document and the numbers in the data cannot
 * drift apart.
 */
export interface LoadTestReport {
  /** ISO 8601, UTC. */
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** Echoed so a report is self-describing. Contains no secrets by construction. */
  config: LoadTestConfig;
  accountsRequested: number;
  accountsFunded: number;
  recordsAttempted: number;
  recordsSucceeded: number;
  recordsFailed: number;
  /** Successful records per second across the whole run. */
  throughputPerSecond: number;
  latency: LatencySummary;
  /** Counter per stage; every stage present, zeroed when unused. */
  failuresByStage: Record<FailureStage, number>;
  /** `get_count` on the action log before and after, null when unreadable. */
  actionLogCountBefore: number | null;
  actionLogCountAfter: number | null;
  /**
   * Distinct authors visible through `get_recent`, null when unreadable.
   *
   * This is a lower bound: `get_recent` is capped, so a run larger than the cap
   * cannot see all of its own authors. The report must say so rather than
   * presenting it as a total.
   */
  distinctAuthorsSeen: number | null;
  /** Caveats worth carrying into the document — cap truncation, throttling, and so on. */
  notes: string[];
}
