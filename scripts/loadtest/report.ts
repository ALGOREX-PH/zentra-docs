/**
 * Results layer of the Zentra load-test harness: raw attempts in, one
 * `LoadTestReport` out, and that one value rendered to Markdown or JSON.
 *
 * Everything here is pure, and the clock arrives as a parameter rather than
 * being read. A results layer that samples `Date.now()` internally cannot be
 * tested for the two numbers most worth trusting — duration and throughput —
 * because the inputs move every time the suite runs.
 *
 * The single-value design is deliberate for the same reason. `buildReport`
 * computes the numbers once; `renderMarkdown` and `renderJson` only format what
 * it produced. Neither derives anything of its own, so the document a reader
 * quotes and the JSON a reviewer parses cannot disagree.
 *
 * Nothing here reads `FundedAccount.secret`, and nothing here should grow a
 * reason to: only `publicKey` is ever touched, and `LoadTestReport` has nowhere
 * to put a secret by construction. See the header of `types.ts`.
 */

import type {
  FailureStage,
  FundingOutcome,
  LatencySummary,
  LoadTestConfig,
  LoadTestReport,
  RecordAttempt,
} from './types';
import { FAILURE_STAGES } from './types';

/**
 * The contract reads taken around a run, each explicitly nullable.
 *
 * Required rather than optional fields: an optional read lets a caller that
 * never managed the call fall through to a default, and a defaulted `0` is
 * indistinguishable from a contract that genuinely holds nothing. Forcing an
 * explicit `null` means an unknown is always stated as one, and the renderer
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
  const value = sorted[index];
  if (value === undefined) {
    // Unreachable: the clamp above keeps `index` inside a non-empty array.
    throw new RangeError('percentileNearestRank: rank resolved outside the sample set');
  }
  return value;
}

/**
 * Latency distribution over `samples`, or a zeroed summary when there are none.
 *
 * `LatencySummary` types every field as `number`, so an empty run has no null to
 * report with: `count: 0` is the only honest signal the shape allows, and it is
 * what `renderMarkdown` keys on to print "no samples" instead of a table of
 * zeroes that reads like a run where everything was instant. Those zeroes mean
 * absent, never measured, and nothing downstream may treat them as latencies.
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
    // p=0 and p=100 clamp to the first and last rank, so min and max fall out
    // of the same guarded lookup as the percentiles.
    minMs: percentileNearestRank(sorted, 0),
    p50Ms: percentileNearestRank(sorted, 50),
    p95Ms: percentileNearestRank(sorted, 95),
    p99Ms: percentileNearestRank(sorted, 99),
    maxMs: percentileNearestRank(sorted, 100),
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
  attempts: readonly RecordAttempt[],
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
 * Fold a finished run into the single `LoadTestReport` both renderers read.
 *
 * Every field on the type is populated here; nothing is estimated, seeded or
 * left to a default. The unknowns that exist — the contract reads — arrive as
 * explicit nulls and stay null.
 */
export function buildReport(input: ReportInput): LoadTestReport {
  const { config, funding, attempts, startedAtMs, finishedAtMs, reads } = input;

  if (!Number.isFinite(startedAtMs) || !Number.isFinite(finishedAtMs)) {
    throw new TypeError(
      'buildReport: startedAtMs and finishedAtMs must be finite epoch milliseconds',
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
    attempts.filter((attempt) => attempt.ok).map((attempt) => attempt.latencyMs),
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
 * Serialise the value the Markdown was rendered from.
 *
 * Two-space indent because these get committed next to the document and read in
 * diffs. Every numeric field is finite by the guards above, so no metric can
 * arrive here as the `null` that `JSON.stringify` substitutes for NaN.
 */
export function renderJson(report: LoadTestReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * The caveat, at the top, in the document.
 *
 * Not a footnote: a reader who takes one number out of this report is the reader
 * most likely to skip the end of it, and the number they take will be a count of
 * accounts. `types.ts` explains why the distinction is load-bearing — the
 * project does present chain-derived counts as adoption elsewhere, so a
 * synthetic run quoted as usage is not a nitpick but a false claim.
 */
const SYNTHETIC_ACCOUNTS_DISCLAIMER = [
  '> **Synthetic accounts. NOT users. NOT adoption evidence.**',
  '>',
  '> Every account in this report was minted by the load-test harness, funded',
  '> from Friendbot, used once and abandoned. They are throwaway testnet',
  '> keypairs, **not users**: nobody signed up, and the harness never writes to',
  '> the signup registry. The contracts exercised here are instances deployed for',
  '> the run, so these records stay out of the chain-derived counts the project',
  '> does present as adoption.',
  '>',
  '> No figure below may be quoted as usage, growth, active accounts or adoption.',
  '> This document measures how the contracts behave under concurrency, and',
  '> nothing else.',
].join('\n');

/** How `distinctAuthorsSeen` is labelled everywhere it is shown. */
const LOWER_BOUND_LABEL = 'Distinct authors seen (LOWER BOUND)';

/** Rendered in place of any metric that came in as an explicit null. */
const UNKNOWN = 'unknown';

/**
 * Escape a value for a Markdown table cell.
 *
 * An unescaped pipe — from `config.message`, an id, a URL — splits the row and
 * shifts every column after it, and a newline ends the table outright. Both
 * corrupt neighbouring numbers silently, which is the failure mode this whole
 * module is built to avoid.
 */
function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * An inline code span sized to survive backticks inside `value`.
 *
 * Config carries operator-supplied strings; a message containing a backtick
 * would close a fixed one-tick span early and spill markup into the table.
 */
function code(value: string): string {
  if (value === '') return '_(empty)_';

  const longestRun = (value.match(/`+/g) ?? []).reduce((n, run) => Math.max(n, run.length), 0);
  const fence = '`'.repeat(longestRun + 1);
  // A span that starts or ends with a backtick needs padding spaces, which the
  // renderer strips again.
  const pad = value.startsWith('`') || value.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${cell(value)}${pad}${fence}`;
}

/**
 * Format a number for the document only.
 *
 * Full precision stays in the JSON; the document rounds fractions to two places
 * so a mean latency does not arrive as seventeen digits. Integers are printed
 * as-is, because a count with a decimal point looks like a rate.
 */
function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** Render an explicit unknown as unknown — never as zero, never as a guess. */
function fmtNullable(value: number | null): string {
  return value === null ? UNKNOWN : fmt(value);
}

/** One `| key | value |` row, with the key escaped and the value pre-formatted. */
function row(label: string, value: string): string {
  return `| ${cell(label)} | ${value} |`;
}

/** Header rows for a two-column table. */
function tableHead(left: string, right: string): string[] {
  return [`| ${left} | ${right} |`, '| --- | --- |'];
}

/**
 * Render a report as a standalone Markdown document.
 *
 * Reads only `report`, so the document cannot state a number the JSON does not
 * contain. Every caveat lives inside the sections it qualifies rather than in a
 * trailing block, because the argument this document has to survive is someone
 * quoting one row of one table out of it.
 */
export function renderMarkdown(report: LoadTestReport): string {
  const lines: string[] = [
    '# Zentra load test — results',
    '',
    SYNTHETIC_ACCOUNTS_DISCLAIMER,
    '',
    '## Run',
    '',
    ...tableHead('Field', 'Value'),
    row('Started (UTC)', code(report.startedAt)),
    row('Finished (UTC)', code(report.finishedAt)),
    row('Wall-clock duration', `${fmt(report.durationMs)} ms (${fmt(report.durationMs / 1000)} s)`),
    '',
    '## Configuration',
    '',
    'Echoed from the run so this document stands alone. It carries no secrets:',
    'the harness mints a secret key per account and keeps it in-process, and the',
    'report type has nowhere to put one.',
    '',
    ...tableHead('Setting', 'Value'),
    row('Accounts requested', fmt(report.config.accounts)),
    row('Concurrency', fmt(report.config.concurrency)),
    row('RPC URL', code(report.config.rpcUrl)),
    row('Network passphrase', code(report.config.networkPassphrase)),
    row('Friendbot URL', code(report.config.friendbotUrl)),
    row('Action log contract', code(report.config.actionLogId)),
    row('Reputation contract', code(report.config.reputationId)),
    row('Recorded message', code(report.config.message)),
    row('Per-operation timeout', `${fmt(report.config.timeoutMs)} ms`),
    '',
    '## Records',
    '',
    ...tableHead('Metric', 'Value'),
    row('Synthetic accounts requested', fmt(report.accountsRequested)),
    row('Synthetic accounts funded', fmt(report.accountsFunded)),
    row('Records attempted', fmt(report.recordsAttempted)),
    row('Records succeeded', fmt(report.recordsSucceeded)),
    row('Records failed', fmt(report.recordsFailed)),
    row('Throughput (successful records/s)', renderThroughput(report)),
    '',
    'Succeeded plus failed always equals attempted: failures are derived by',
    'subtraction, not counted separately. Accounts are synthetic throwaway',
    'keypairs — see the notice above before quoting any count here.',
    '',
    ...renderLatencySection(report),
    '',
    '## Failures by stage',
    '',
    ...tableHead('Stage', 'Failures'),
    ...FAILURE_STAGES.map((stage) => row(`\`${stage}\``, fmt(report.failuresByStage[stage]))),
    '',
    'Every stage is listed, zeroed where nothing failed, so a blank is never a',
    'gap in the data. The column spans the whole pipeline including funding, so',
    'it need not sum to records failed: an account Friendbot refused never',
    'reached `record()` to be counted as an attempt. Read `funding` as',
    'infrastructure throttling, which says nothing about the contracts, and',
    '`confirm` as the network or the contracts rejecting real work.',
    '',
    '## On-chain reads',
    '',
    ...tableHead('Read', 'Value'),
    row('Action log `get_count` before', fmtNullable(report.actionLogCountBefore)),
    row('Action log `get_count` after', fmtNullable(report.actionLogCountAfter)),
    row(LOWER_BOUND_LABEL, fmtNullable(report.distinctAuthorsSeen)),
    '',
    `\`${UNKNOWN}\` means the read failed or was not taken. It is not zero, and it`,
    'must not be substituted with one.',
    '',
    `**${LOWER_BOUND_LABEL}** is a **lower bound**, never a total: \`get_recent\``,
    'returns a capped window, so a run larger than the cap cannot observe all of',
    'its own authors. The true figure is at least this and may be higher.',
    '',
    ...renderNotesSection(report),
  ];

  return `${lines.join('\n')}\n`;
}

/**
 * Throughput, or an explicit unknown when there was no clock to divide by.
 *
 * `buildReport` holds the field at zero in that case, and printing that zero
 * here would read as a measured stall rather than a missing measurement.
 */
function renderThroughput(report: LoadTestReport): string {
  if (report.durationMs <= 0) {
    return `${UNKNOWN} (wall-clock duration was not positive)`;
  }
  return fmt(report.throughputPerSecond);
}

/**
 * The latency table, or a statement that there is nothing to tabulate.
 *
 * `count: 0` is the empty-set marker `summariseLatency` is forced into by a
 * summary type with no nullable fields; rendering its zeroes as a table would
 * claim a run where every write returned instantly.
 */
function renderLatencySection(report: LoadTestReport): string[] {
  const { latency } = report;

  if (latency.count === 0) {
    return [
      '## Latency',
      '',
      'No successful records, so there are no latency samples. The zeroes in the',
      '`latency` block of the JSON mark an empty set alongside `count: 0`; they',
      'are not measured durations and must not be read as any.',
    ];
  }

  return [
    '## Latency',
    '',
    ...tableHead('Statistic', 'Value'),
    row('Samples', fmt(latency.count)),
    row('Minimum', `${fmt(latency.minMs)} ms`),
    row('p50', `${fmt(latency.p50Ms)} ms`),
    row('p95', `${fmt(latency.p95Ms)} ms`),
    row('p99', `${fmt(latency.p99Ms)} ms`),
    row('Maximum', `${fmt(latency.maxMs)} ms`),
    row('Mean', `${fmt(latency.meanMs)} ms`),
    '',
    `Build-through-confirm latency over the ${fmt(latency.count)} successful`,
    `record${latency.count === 1 ? '' : 's'} of ${fmt(report.recordsAttempted)} attempted.`,
    'Failed attempts are excluded: a submission that failed fast is a quick',
    'error, not a quick write. Percentiles are nearest-rank — the sample at',
    'one-based rank `ceil(p × n / 100)` of the ascending samples — so every',
    'figure above is a duration that actually occurred rather than an',
    'interpolation between two that did.',
  ];
}

/** Notes, unedited. A caveat rewritten to fit the table is a caveat weakened. */
function renderNotesSection(report: LoadTestReport): string[] {
  if (report.notes.length === 0) {
    return ['## Notes', '', 'No notes recorded for this run.'];
  }

  return ['## Notes', '', ...report.notes.map((note) => `- ${note}`)];
}
