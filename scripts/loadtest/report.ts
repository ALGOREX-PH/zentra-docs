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

import type { LatencySummary } from './types';

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
