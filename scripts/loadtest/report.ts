/**
 * Results layer of the Zentra load-test harness: raw attempts in, one
 * `LoadTestReport` out.
 *
 * Everything here is pure, and the clock arrives as a parameter rather than
 * being read. A results layer that samples `Date.now()` internally cannot be
 * tested for the two numbers most worth trusting — duration and throughput —
 * because the inputs move every time the suite runs.
 *
 * Nothing here reads `FundedAccount.secret`, and nothing here should grow a
 * reason to: only `publicKey` is ever touched, and `LoadTestReport` has nowhere
 * to put a secret by construction. See the header of `types.ts`.
 */

import { FAILURE_STAGES } from './types';
import type {
  FailureStage,
  FundingOutcome,
  LatencySummary,
  LoadTestConfig,
  LoadTestReport,
  RecordAttempt,
} from './types';

/**
 * The contract reads taken around a run, each explicitly nullable.
 *
 * Required rather than optional fields: an optional read lets a caller that
 * never managed the call fall through to a default, and a defaulted `0` is
 * indistinguishable from a contract that genuinely holds nothing. Forcing an
 * explicit `null` means an unknown is always stated as one, and a renderer
 * prints it as unknown rather than as a plausible-looking zero.
 */
export interface ChainReads {
  actionLogCountBefore: number | null;
  actionLogCountAfter: number | null;
  distinctAuthorsSeen: number | null;
}

/** Everything `buildReport` needs. No clock, no network, no files. */
export interface ReportInput {
  /** Echoed into the report so the document is self-describing. */
  config: LoadTestConfig;
  funding: FundingOutcome;
  attempts: readonly RecordAttempt[];
  /**
   * Run bounds as epoch milliseconds.
   *
   * Numeric rather than ISO strings because duration is arithmetic; the ISO
   * fields on the report are derived from these, so the stamps and the elapsed
   * time can never describe different runs.
   */
  startedAtMs: number;
  finishedAtMs: number;
  reads: ChainReads;
  /** Caveats observed during the run. `buildReport` may append its own. */
  notes?: readonly string[];
}

/**
 * Appended when the wall clock gives nothing to divide by.
 *
 * Exported so a caller can recognise a harness-generated caveat among its own.
 */
export const NON_POSITIVE_DURATION_NOTE =
  'Throughput could not be computed: the wall-clock duration was not positive, so successful records per second is reported as unknown rather than as a rate.';

/**
 * Percentile by nearest rank: the p-th percentile is the sample at one-based
 * rank `ceil(p * n / 100)` of `sorted`, ascending.
 *
 * Nearest rank rather than linear interpolation, because every value it returns
 * is a latency that actually happened. An interpolated p95 is a duration no
 * submission ever took, which is impossible to defend the moment someone asks
 * which transaction it was.
 *
 * The rank is `p * n / 100` and never `(p / 100) * n`. `p / 100` is inexact in
 * binary — 0.95 has no exact double — so the second form can land a hair either
 * side of a whole number and `ceil` then moves the answer a full rank. That
 * misfires on exactly the round sample counts a load test uses. Multiplying the
 * two integers first keeps the numerator exact and leaves one rounding, in the
 * division, where it cannot cross an integer boundary that matters.
 *
 * `sorted` must already be ascending: `summariseLatency` sorts once and reuses
 * the order across all three percentiles instead of paying for a sort each time.
 */
export function percentileNearestRank(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    throw new RangeError('percentileNearestRank: an empty sample set has no percentile');
  }

  const rank = Math.ceil((p * sorted.length) / 100);
  // Clamped so a `p` at or past either extreme resolves to the min or the max
  // instead of indexing off the end and returning `undefined` as a number.
  const index = Math.min(Math.max(rank, 1), sorted.length) - 1;
  return sorted[index];
}

/**
 * Latency distribution over `samples`, or a zeroed summary when there are none.
 *
 * `LatencySummary` types every field as `number`, so an empty run has no null to
 * report with: `count: 0` is the only honest signal the shape allows, and it is
 * what the renderer keys on to print "no samples" instead of a table of zeroes
 * that reads like a run where everything was instant. Those zeroes mean absent,
 * never measured, and nothing downstream may treat them as latencies.
 *
 * With one sample every percentile is that sample; with two, nearest rank puts
 * p50 on the lower and p95 and p99 on the upper. Both fall out of the rank
 * formula rather than being special-cased, which is why they are worth a test
 * but not a branch.
 */
export function summariseLatency(samples: readonly number[]): LatencySummary {
  for (const sample of samples) {
    // One NaN would poison the sort, all three percentiles and the mean, and
    // none of the output would look wrong. Fail at the bad sample instead of
    // publishing a report that is quietly meaningless.
    if (!Number.isFinite(sample)) {
      throw new TypeError(`summariseLatency: latency sample is not finite: ${String(sample)}`);
    }
  }

  if (samples.length === 0) {
    return { count: 0, minMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0, meanMs: 0 };
  }

  // Copied before sorting so a caller's array keeps the attempt order it was
  // built in, and with an explicit numeric comparator because the default sort
  // is lexicographic and would rank 1000 ms below 200 ms.
  const sorted = [...samples].sort((a, b) => a - b);
  const total = sorted.reduce((sum, ms) => sum + ms, 0);

  return {
    count: sorted.length,
    minMs: sorted[0],
    p50Ms: percentileNearestRank(sorted, 50),
    p95Ms: percentileNearestRank(sorted, 95),
    p99Ms: percentileNearestRank(sorted, 99),
    maxMs: sorted[sorted.length - 1],
    meanMs: total / sorted.length,
  };
}

/**
 * Tally failures per stage across the whole pipeline, funding included.
 *
 * Seeded from `FAILURE_STAGES` rather than from the failures actually observed,
 * so every stage has a row and a reader can tell "nothing failed here" from
 * "this stage was never reported on". A table with holes invites the reader to
 * guess which one it was.
 *
 * Funding failures are counted alongside attempt failures because the question
 * after a run is which layer gave out, and an account Friendbot refused never
 * reaches `record()` to be counted anywhere else. The consequence is that the
 * column does not sum to `recordsFailed`, which the document states outright.
 */
function tallyFailuresByStage(
  funding: FundingOutcome,
  attempts: readonly RecordAttempt[]
): Record<FailureStage, number> {
  const byStage = Object.fromEntries(FAILURE_STAGES.map((stage) => [stage, 0])) as Record<
    FailureStage,
    number
  >;

  const bump = (stage: FailureStage): void => {
    // Types cannot reach a report rebuilt from deserialised JSON. An unrecognised
    // stage would turn one counter into NaN and take the table with it.
    if (!(stage in byStage)) {
      throw new TypeError(`tallyFailuresByStage: unknown failure stage: ${String(stage)}`);
    }
    byStage[stage] += 1;
  };

  for (const failure of funding.failures) bump(failure.stage);
  for (const attempt of attempts) {
    if (attempt.failure) bump(attempt.failure.stage);
  }

  return byStage;
}

/**
 * Fold a finished run into the single `LoadTestReport` every rendering reads.
 *
 * Every field on the type is populated here; nothing is estimated, seeded or
 * left to a default. The unknowns that exist — the contract reads — arrive as
 * explicit nulls and stay null.
 */
export function buildReport(input: ReportInput): LoadTestReport {
  const { config, funding, attempts, startedAtMs, finishedAtMs, reads } = input;

  if (!Number.isFinite(startedAtMs) || !Number.isFinite(finishedAtMs)) {
    throw new TypeError(
      'buildReport: startedAtMs and finishedAtMs must be finite epoch milliseconds'
    );
  }

  const durationMs = finishedAtMs - startedAtMs;

  // Failures are derived by subtraction rather than counted independently, so
  // succeeded plus failed equals attempted even for an attempt that arrives with
  // `ok: false` and no `failure` attached. Two independent counts drift; one
  // count and a subtraction cannot.
  const recordsSucceeded = attempts.reduce((n, attempt) => (attempt.ok ? n + 1 : n), 0);
  const recordsFailed = attempts.length - recordsSucceeded;

  // Successful records only. A submission that failed in 40 ms is a fast error,
  // not a fast write, and letting it into the distribution drags p50 down
  // exactly when the run went worst — the opposite of what the tail is for.
  const latency = summariseLatency(
    attempts.filter((attempt) => attempt.ok).map((attempt) => attempt.latencyMs)
  );

  const notes = [...(input.notes ?? [])];

  // A non-positive wall clock is a clock artefact, not a rate of zero. Dividing
  // by it yields Infinity or NaN, and both serialise to `null` in JSON while
  // reading as a measurement in Markdown. Hold the field at zero, record why,
  // and let the renderer print the rate as unknown.
  let throughputPerSecond = 0;
  if (durationMs > 0) {
    throughputPerSecond = recordsSucceeded / (durationMs / 1000);
  } else {
    notes.push(NON_POSITIVE_DURATION_NOTE);
  }

  return {
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs,
    config,
    accountsRequested: config.accounts,
    accountsFunded: funding.funded.length,
    recordsAttempted: attempts.length,
    recordsSucceeded,
    recordsFailed,
    throughputPerSecond,
    latency,
    failuresByStage: tallyFailuresByStage(funding, attempts),
    actionLogCountBefore: reads.actionLogCountBefore,
    actionLogCountAfter: reads.actionLogCountAfter,
    distinctAuthorsSeen: reads.distinctAuthorsSeen,
    notes,
  };
}

/**
 * Serialise a report for the run's JSON artefact.
 *
 * Two-space indent because these get committed and read in diffs. Every numeric
 * field is finite by the guards above, so no metric can arrive here as the
 * `null` that `JSON.stringify` substitutes for NaN.
 */
export function renderJson(report: LoadTestReport): string {
  return JSON.stringify(report, null, 2);
}
