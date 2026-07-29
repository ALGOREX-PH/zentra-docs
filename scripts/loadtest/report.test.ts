import { describe, expect, it } from 'vitest';
import {
  buildReport,
  NON_POSITIVE_DURATION_NOTE,
  percentileNearestRank,
  renderJson,
  renderMarkdown,
  summariseLatency,
} from './report';
import type { ChainReads, ReportInput } from './report';
import { FAILURE_STAGES } from './types';
import type { FailureStage, FundingOutcome, LoadTestConfig, RecordAttempt } from './types';

/** Fixed clock, so duration and throughput are checkable arithmetic. */
const STARTED_MS = 1_700_000_000_000;
const STARTED_ISO = '2023-11-14T22:13:20.000Z';

const CONFIG: LoadTestConfig = {
  accounts: 5,
  concurrency: 2,
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  friendbotUrl: 'https://friendbot.stellar.org',
  actionLogId: 'CACTIONLOGIDFORTHISRUNONLY',
  reputationId: 'CREPUTATIONIDFORTHISRUNONLY',
  message: 'load test',
  timeoutMs: 30_000,
};

function funded(publicKey: string): FundingOutcome['funded'][number] {
  return { publicKey, secret: `S_SECRET_${publicKey}`, fundedAtLedger: 42, fundingMs: 800 };
}

function ok(publicKey: string, latencyMs: number): RecordAttempt {
  return { publicKey, ok: true, latencyMs, txHash: `hash-${publicKey}`, ledger: 43, failure: null };
}

function failed(publicKey: string, stage: FailureStage, latencyMs = 50): RecordAttempt {
  return {
    publicKey,
    ok: false,
    latencyMs,
    txHash: null,
    ledger: null,
    failure: { publicKey, stage, message: `${stage} gave out` },
  };
}

const READS: ChainReads = {
  actionLogCountBefore: 10,
  actionLogCountAfter: 14,
  distinctAuthorsSeen: 4,
};

function input(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    config: CONFIG,
    funding: { funded: [funded('GA'), funded('GB'), funded('GC'), funded('GD')], failures: [] },
    attempts: [ok('GA', 1200), ok('GB', 300), ok('GC', 900), ok('GD', 2500)],
    startedAtMs: STARTED_MS,
    finishedAtMs: STARTED_MS + 4000,
    reads: READS,
    ...overrides,
  };
}

describe('percentileNearestRank', () => {
  it('matches a hand-computed set of ten samples', () => {
    // Ranks are ceil(p × 10 / 100): p50 → 5th → 500, p95 → 10th → 1000.
    const sorted = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];

    expect(percentileNearestRank(sorted, 50)).toBe(500);
    expect(percentileNearestRank(sorted, 95)).toBe(1000);
    expect(percentileNearestRank(sorted, 99)).toBe(1000);
  });

  it('lands p95 on rank 19 of twenty samples, where an inexact p/100 would slip', () => {
    // 95 × 20 / 100 is exactly 19; (95 / 100) × 20 is the form that can drift.
    const sorted = Array.from({ length: 20 }, (_, i) => (i + 1) * 5);

    expect(percentileNearestRank(sorted, 50)).toBe(50);
    expect(percentileNearestRank(sorted, 95)).toBe(95);
    expect(percentileNearestRank(sorted, 99)).toBe(100);
  });

  it('matches a hand-computed set of five samples', () => {
    // ceil(5 × 50/100)=3 → 77, ceil(5 × 95/100)=5 → 900.
    const sorted = [5, 40, 77, 120, 900];

    expect(percentileNearestRank(sorted, 50)).toBe(77);
    expect(percentileNearestRank(sorted, 95)).toBe(900);
  });

  it('clamps a percentile at or beyond either end to the min and the max', () => {
    const sorted = [10, 20, 30];

    expect(percentileNearestRank(sorted, 0)).toBe(10);
    expect(percentileNearestRank(sorted, 100)).toBe(30);
    expect(percentileNearestRank(sorted, 150)).toBe(30);
  });

  it('refuses an empty set rather than inventing a percentile', () => {
    expect(() => percentileNearestRank([], 95)).toThrow(RangeError);
  });
});

describe('summariseLatency', () => {
  it('summarises a hand-computed set', () => {
    expect(summariseLatency([1200, 300, 900, 2500])).toEqual({
      count: 4,
      minMs: 300,
      p50Ms: 900,
      p95Ms: 2500,
      p99Ms: 2500,
      maxMs: 2500,
      meanMs: 1225,
    });
  });

  it('returns count zero for an empty set, with zeroes that mean absent', () => {
    const summary = summariseLatency([]);

    expect(summary.count).toBe(0);
    expect(summary).toEqual({
      count: 0,
      minMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      maxMs: 0,
      meanMs: 0,
    });
  });

  it('reports a single sample as every statistic', () => {
    expect(summariseLatency([42])).toEqual({
      count: 1,
      minMs: 42,
      p50Ms: 42,
      p95Ms: 42,
      p99Ms: 42,
      maxMs: 42,
      meanMs: 42,
    });
  });

  it('splits two samples across p50 and the upper percentiles', () => {
    expect(summariseLatency([90, 10])).toEqual({
      count: 2,
      minMs: 10,
      p50Ms: 10,
      p95Ms: 90,
      p99Ms: 90,
      maxMs: 90,
      meanMs: 50,
    });
  });

  it('orders numerically, not lexicographically', () => {
    const summary = summariseLatency([1000, 200, 30]);

    expect(summary.minMs).toBe(30);
    expect(summary.maxMs).toBe(1000);
  });

  it('leaves the caller array untouched', () => {
    const samples = [1200, 300, 900];
    summariseLatency(samples);

    expect(samples).toEqual([1200, 300, 900]);
  });

  it('throws on a non-finite sample instead of publishing a poisoned summary', () => {
    expect(() => summariseLatency([100, Number.NaN])).toThrow(TypeError);
    expect(() => summariseLatency([100, Number.POSITIVE_INFINITY])).toThrow(TypeError);
  });
});

describe('buildReport', () => {
  it('populates every field of the report from a clean run', () => {
    const report = buildReport(input());

    expect(report.startedAt).toBe(STARTED_ISO);
    expect(report.finishedAt).toBe('2023-11-14T22:13:24.000Z');
    expect(report.durationMs).toBe(4000);
    expect(report.config).toEqual(CONFIG);
    expect(report.accountsRequested).toBe(5);
    expect(report.accountsFunded).toBe(4);
    expect(report.recordsAttempted).toBe(4);
    expect(report.recordsSucceeded).toBe(4);
    expect(report.recordsFailed).toBe(0);
    expect(report.throughputPerSecond).toBe(1);
    expect(report.latency.p95Ms).toBe(2500);
    expect(report.actionLogCountBefore).toBe(10);
    expect(report.actionLogCountAfter).toBe(14);
    expect(report.distinctAuthorsSeen).toBe(4);
    expect(report.notes).toEqual([]);
  });

  it('reconciles succeeded and failed against attempted', () => {
    const attempts = [
      ok('GA', 100),
      failed('GB', 'submit'),
      ok('GC', 200),
      failed('GD', 'confirm'),
      failed('GE', 'build'),
    ];
    const report = buildReport(input({ attempts }));

    expect(report.recordsAttempted).toBe(5);
    expect(report.recordsSucceeded).toBe(2);
    expect(report.recordsFailed).toBe(3);
    expect(report.recordsSucceeded + report.recordsFailed).toBe(report.recordsAttempted);
  });

  it('counts an unsuccessful attempt as failed even with no failure attached', () => {
    const orphan: RecordAttempt = {
      publicKey: 'GX',
      ok: false,
      latencyMs: 10,
      txHash: null,
      ledger: null,
      failure: null,
    };
    const report = buildReport(input({ attempts: [ok('GA', 100), orphan] }));

    expect(report.recordsSucceeded).toBe(1);
    expect(report.recordsFailed).toBe(1);
    expect(report.recordsSucceeded + report.recordsFailed).toBe(report.recordsAttempted);
  });

  it('includes every failure stage, zeroed when unused', () => {
    const report = buildReport(input());

    expect(Object.keys(report.failuresByStage).sort()).toEqual([...FAILURE_STAGES].sort());
    for (const stage of FAILURE_STAGES) {
      expect(report.failuresByStage[stage]).toBe(0);
    }
  });

  it('tallies funding failures alongside attempt failures', () => {
    const report = buildReport(
      input({
        funding: {
          funded: [funded('GA')],
          failures: [
            { publicKey: 'GB', stage: 'funding', message: 'friendbot 429' },
            { publicKey: 'GC', stage: 'funding', message: 'friendbot 429' },
            { publicKey: 'GD', stage: 'keypair', message: 'entropy unavailable' },
          ],
        },
        attempts: [ok('GA', 100), failed('GA2', 'confirm'), failed('GA3', 'confirm')],
      })
    );

    expect(report.failuresByStage).toEqual({
      keypair: 1,
      funding: 2,
      build: 0,
      sign: 0,
      submit: 0,
      confirm: 2,
    });
  });

  it('measures latency over successful records only', () => {
    const report = buildReport(
      input({ attempts: [ok('GA', 1000), failed('GB', 'submit', 5), ok('GC', 2000)] })
    );

    expect(report.latency.count).toBe(report.recordsSucceeded);
    expect(report.latency.minMs).toBe(1000);
    expect(report.latency.meanMs).toBe(1500);
  });

  it('reports an empty latency summary when nothing succeeded', () => {
    const report = buildReport({ ...input(), attempts: [failed('GA', 'confirm')] });

    expect(report.latency.count).toBe(0);
    expect(report.recordsSucceeded).toBe(0);
    expect(report.throughputPerSecond).toBe(0);
  });

  it('computes throughput as successful records per wall-clock second', () => {
    const report = buildReport(
      input({
        attempts: [ok('GA', 100), ok('GB', 100), ok('GC', 100), failed('GD', 'confirm')],
        finishedAtMs: STARTED_MS + 1500,
      })
    );

    expect(report.throughputPerSecond).toBe(2);
  });

  it('guards a zero duration instead of emitting Infinity or NaN', () => {
    const report = buildReport(input({ finishedAtMs: STARTED_MS }));

    expect(report.durationMs).toBe(0);
    expect(Number.isFinite(report.throughputPerSecond)).toBe(true);
    expect(report.throughputPerSecond).toBe(0);
    expect(report.notes).toContain(NON_POSITIVE_DURATION_NOTE);
  });

  it('guards a negative duration the same way', () => {
    const report = buildReport(input({ finishedAtMs: STARTED_MS - 1000 }));

    expect(report.durationMs).toBe(-1000);
    expect(Number.isFinite(report.throughputPerSecond)).toBe(true);
    expect(report.notes).toContain(NON_POSITIVE_DURATION_NOTE);
  });

  it('keeps null reads null rather than defaulting them to zero', () => {
    const report = buildReport(
      input({
        reads: { actionLogCountBefore: null, actionLogCountAfter: null, distinctAuthorsSeen: null },
      })
    );

    expect(report.actionLogCountBefore).toBeNull();
    expect(report.actionLogCountAfter).toBeNull();
    expect(report.distinctAuthorsSeen).toBeNull();
  });

  it('carries caller notes through and does not mutate the caller array', () => {
    const notes = ['get_recent is capped at 20 entries, so authors are undercounted.'];
    const report = buildReport(input({ notes, finishedAtMs: STARTED_MS }));

    expect(report.notes[0]).toBe(notes[0]);
    expect(report.notes).toHaveLength(2);
    expect(notes).toHaveLength(1);
  });

  it('rejects a non-finite clock', () => {
    expect(() => buildReport(input({ finishedAtMs: Number.NaN }))).toThrow(TypeError);
    expect(() => buildReport(input({ startedAtMs: Number.POSITIVE_INFINITY }))).toThrow(TypeError);
  });

  it('rejects an unrecognised failure stage from deserialised data', () => {
    const bogus = {
      publicKey: 'GB',
      stage: 'teleport' as unknown as FailureStage,
      message: 'not a stage',
    };

    expect(() =>
      buildReport(input({ funding: { funded: [funded('GA')], failures: [bogus] } }))
    ).toThrow(TypeError);
  });
});

describe('renderMarkdown', () => {
  it('states near the top that the accounts are synthetic and not users', () => {
    const md = renderMarkdown(buildReport(input()));

    expect(md).toContain('Synthetic accounts. NOT users. NOT adoption evidence.');
    expect(md).toContain('throwaway testnet');
    expect(md).toContain('**not users**');
    expect(md).toContain('may be quoted as usage, growth, active accounts or adoption');
    // Before any number a reader could lift out of the document.
    expect(md.indexOf('NOT adoption evidence')).toBeLessThan(md.indexOf('## Records'));
  });

  it('labels distinct authors as a lower bound and explains the cap', () => {
    const md = renderMarkdown(buildReport(input()));

    expect(md).toContain('| Distinct authors seen (LOWER BOUND) | 4 |');
    expect(md).toContain('is a **lower bound**, never a total');
    expect(md).toContain('`get_recent`');
  });

  it('renders a null read as unknown, never as zero', () => {
    const md = renderMarkdown(
      buildReport(
        input({
          reads: {
            actionLogCountBefore: null,
            actionLogCountAfter: null,
            distinctAuthorsSeen: null,
          },
        })
      )
    );

    expect(md).toContain('| Action log `get_count` before | unknown |');
    expect(md).toContain('| Action log `get_count` after | unknown |');
    expect(md).toContain('| Distinct authors seen (LOWER BOUND) | unknown |');
    expect(md).not.toContain('| Action log `get_count` before | 0 |');
    expect(md).not.toContain('| Distinct authors seen (LOWER BOUND) | 0 |');
  });

  it('distinguishes a genuine zero read from an unknown one', () => {
    const md = renderMarkdown(
      buildReport(
        input({
          reads: { actionLogCountBefore: 0, actionLogCountAfter: 4, distinctAuthorsSeen: 0 },
        })
      )
    );

    expect(md).toContain('| Action log `get_count` before | 0 |');
    expect(md).toContain('| Distinct authors seen (LOWER BOUND) | 0 |');
  });

  it('renders throughput as unknown when the duration was not positive', () => {
    const md = renderMarkdown(buildReport(input({ finishedAtMs: STARTED_MS })));

    expect(md).toContain(
      '| Throughput (successful records/s) | unknown (wall-clock duration was not positive) |'
    );
    expect(md).not.toContain('| Throughput (successful records/s) | 0 |');
  });

  it('renders every failure stage, including the unused ones', () => {
    const md = renderMarkdown(buildReport(input({ attempts: [failed('GA', 'confirm')] })));

    for (const stage of FAILURE_STAGES) {
      expect(md).toContain(`| \`${stage}\` |`);
    }
    expect(md).toContain('| `confirm` | 1 |');
    expect(md).toContain('| `sign` | 0 |');
    expect(md).toContain('need not sum to records failed');
  });

  it('states the percentile method and the sample basis', () => {
    const md = renderMarkdown(buildReport(input()));

    expect(md).toContain('| p95 | 2500 ms |');
    expect(md).toContain('nearest-rank');
    expect(md).toContain('4 successful');
    expect(md).toContain('Failed attempts are excluded');
  });

  it('says there are no latency samples instead of tabulating zeroes', () => {
    const md = renderMarkdown(buildReport(input({ attempts: [failed('GA', 'confirm')] })));

    expect(md).toContain('No successful records, so there are no latency samples.');
    expect(md).not.toContain('| p95 | 0 ms |');
  });

  it('renders notes verbatim', () => {
    const notes = [
      'get_recent is capped at 20; distinct authors is undercounted for a 50-account run.',
      'Friendbot returned 429 for 3 accounts | throttling, not a contract limit.',
    ];
    const md = renderMarkdown(buildReport(input({ notes })));

    expect(md).toContain(`- ${notes[0]}`);
    expect(md).toContain(`- ${notes[1]}`);
  });

  it('says so when there are no notes', () => {
    const md = renderMarkdown(buildReport(input()));

    expect(md).toContain('No notes recorded for this run.');
  });

  it('escapes a pipe in config so it cannot shift the columns of a table', () => {
    const config = { ...CONFIG, message: 'a | b', actionLogId: 'C|BROKEN' };
    const md = renderMarkdown(buildReport(input({ config })));

    expect(md).toContain('| Recorded message | `a \\| b` |');
    expect(md).toContain('| Action log contract | `C\\|BROKEN` |');
    // Every table row still has its two cells and nothing more.
    for (const line of md.split('\n').filter((l) => l.startsWith('| ') && !l.includes('---'))) {
      expect(line.split(/(?<!\\)\|/)).toHaveLength(4);
    }
  });

  it('never renders secret material, because the aggregator never reads it', () => {
    // `funded()` gives every account an unmistakable secret; the report type has
    // nowhere to carry one, so neither rendering can leak it.
    const report = buildReport(input());

    expect(renderMarkdown(report)).not.toContain('S_SECRET_');
    expect(renderJson(report)).not.toContain('S_SECRET_');
  });

  it('echoes the config so the document stands alone', () => {
    const md = renderMarkdown(buildReport(input()));

    expect(md).toContain('| Concurrency | 2 |');
    expect(md).toContain('| RPC URL | `https://soroban-testnet.stellar.org` |');
    expect(md).toContain('| Per-operation timeout | 30000 ms |');
    expect(md).toContain(`| Started (UTC) | \`${STARTED_ISO}\` |`);
  });

  it('ends with a trailing newline, as a committed file should', () => {
    expect(renderMarkdown(buildReport(input())).endsWith('\n')).toBe(true);
  });
});

describe('renderJson', () => {
  it('round-trips the same value the Markdown is rendered from', () => {
    const report = buildReport(input());

    expect(JSON.parse(renderJson(report))).toEqual(report);
  });

  it('agrees with the Markdown, because both read one report', () => {
    const report = buildReport(input({ finishedAtMs: STARTED_MS + 2000 }));
    const parsed = JSON.parse(renderJson(report)) as { throughputPerSecond: number };
    const md = renderMarkdown(report);

    expect(parsed.throughputPerSecond).toBe(2);
    expect(md).toContain('| Throughput (successful records/s) | 2 |');
  });

  it('emits no null in place of a metric, even with a zero duration', () => {
    const json = renderJson(buildReport(input({ finishedAtMs: STARTED_MS })));

    expect(json).toContain('"throughputPerSecond": 0');
    expect(json).not.toContain('"throughputPerSecond": null');
    expect(json).not.toContain('"p95Ms": null');
  });

  it('preserves an unknown read as null rather than zero', () => {
    const json = renderJson(
      buildReport(
        input({
          reads: {
            actionLogCountBefore: null,
            actionLogCountAfter: null,
            distinctAuthorsSeen: null,
          },
        })
      )
    );

    expect(json).toContain('"distinctAuthorsSeen": null');
    expect(json).not.toContain('"distinctAuthorsSeen": 0');
  });
});
