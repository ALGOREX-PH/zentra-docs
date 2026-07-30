import { Keypair } from '@stellar/stellar-sdk';
import { describe, it, expect } from 'vitest';

import {
  DEFAULT_MAX_ATTEMPTS,
  provisionAccounts,
  REDACTED,
  UNKNOWN_PUBLIC_KEY,
  type FetchLike,
  type FriendbotResponse,
  type ProvisionOptions,
  type SleepLike,
} from './accounts';

/**
 * Every test drives the module through injected collaborators: no network, no
 * real waiting. The only place real timers are used is the timeout suite, where
 * the point is that the `AbortSignal` is genuinely wired up.
 */
const OPTIONS: ProvisionOptions = {
  accounts: 1,
  concurrency: 1,
  friendbotUrl: 'https://friendbot.example/',
  timeoutMs: 1_000,
  maxAttempts: 3,
  baseBackoffMs: 100,
  maxBackoffMs: 1_000,
};

/** Anything shaped like a Stellar seed. Asserted absent from returned messages. */
const SEED_SHAPE = /S[A-Z2-7]{55}/;

/** A Friendbot reply, as the narrow shape the module actually reads. */
function respond(status: number, body = ''): FriendbotResponse {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

/** A funding success carrying a ledger, the way testnet Friendbot answers. */
function funded(ledger: number): FriendbotResponse {
  return respond(200, JSON.stringify({ hash: 'abc', ledger }));
}

/** Records every call so a test can assert on attempt counts and URLs. */
function recordingFetch(
  handler: (call: number, url: string, signal: AbortSignal) => Promise<FriendbotResponse>,
): { fetch: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const fetchLike: FetchLike = (url, init) => {
    const call = urls.length;
    urls.push(url);
    return handler(call, url, init.signal);
  };
  return { fetch: fetchLike, urls };
}

/** A sleep that never waits but remembers every delay it was asked for. */
function recordingSleep(): { sleep: SleepLike; delays: number[] } {
  const delays: number[] = [];
  return {
    sleep: async (ms) => {
      delays.push(ms);
    },
    delays,
  };
}

/** The `addr` a request was made for. */
function addrOf(url: string): string {
  return new URL(url).searchParams.get('addr') ?? '';
}

/** Zero jitter, so an asserted backoff is the bottom of its window exactly. */
const NO_JITTER = () => 0;

describe('provisionAccounts — successful batches', () => {
  it('funds every account and reports the ledger Friendbot gave', async () => {
    const { fetch, urls } = recordingFetch(async (call) => funded(500 + call));
    const { sleep, delays } = recordingSleep();

    const outcome = await provisionAccounts(
      { ...OPTIONS, accounts: 5, concurrency: 2 },
      { fetch, sleep, random: NO_JITTER },
    );

    expect(outcome.funded).toHaveLength(5);
    expect(outcome.failures).toEqual([]);
    expect(urls).toHaveLength(5);
    // Nothing was retryable, so nothing backed off.
    expect(delays).toEqual([]);

    for (const account of outcome.funded) {
      expect(account.publicKey).toMatch(/^G[A-Z2-7]{55}$/);
      expect(account.fundedAtLedger).toBeGreaterThan(0);
      expect(Number.isInteger(account.fundingMs)).toBe(true);
      expect(account.fundingMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('mints a distinct keypair per account, each secret matching its public key', async () => {
    const { fetch } = recordingFetch(async () => funded(1));

    const outcome = await provisionAccounts({ ...OPTIONS, accounts: 6, concurrency: 3 }, { fetch });

    const publicKeys = new Set(outcome.funded.map((account) => account.publicKey));
    expect(publicKeys.size).toBe(6);

    // The returned secret must actually control the returned address, otherwise
    // the account is useless for the signing phase that follows.
    for (const account of outcome.funded) {
      expect(Keypair.fromSecret(account.secret).publicKey()).toBe(account.publicKey);
    }
  });

  it('requests one Friendbot URL per account, carrying that account as addr', async () => {
    const { fetch, urls } = recordingFetch(async () => funded(7));

    const outcome = await provisionAccounts({ ...OPTIONS, accounts: 3, concurrency: 3 }, { fetch });

    const requested = urls.map(addrOf).sort();
    const provisioned = outcome.funded.map((account) => account.publicKey).sort();
    expect(requested).toEqual(provisioned);
  });

  it('replaces an addr already present on the configured base rather than appending one', async () => {
    const { fetch, urls } = recordingFetch(async () => funded(7));

    const outcome = await provisionAccounts(
      { ...OPTIONS, accounts: 1, friendbotUrl: 'https://friendbot.example/?addr=GSTALE' },
      { fetch },
    );

    const url = new URL(urls[0] ?? '');
    expect(url.searchParams.getAll('addr')).toEqual([outcome.funded[0]?.publicKey]);
  });

  it('does nothing at all for a zero-account run', async () => {
    const { fetch, urls } = recordingFetch(async () => funded(1));

    const outcome = await provisionAccounts({ ...OPTIONS, accounts: 0 }, { fetch });

    expect(outcome).toEqual({ funded: [], failures: [] });
    expect(urls).toEqual([]);
  });

  it('measures fundingMs from before keypair generation to after funding', async () => {
    const { fetch } = recordingFetch(async () => funded(1));
    const readings = [1_000, 1_250];
    let reading = 0;

    const outcome = await provisionAccounts(
      { ...OPTIONS, accounts: 1 },
      { fetch, now: () => readings[reading++] ?? 0 },
    );

    expect(outcome.funded[0]?.fundingMs).toBe(250);
  });
});

describe('provisionAccounts — partial results', () => {
  it('returns the survivors when some accounts fail', async () => {
    // Odd-numbered addresses, in request order, are refused outright.
    const order = new Map<string, number>();
    const { fetch } = recordingFetch(async (_call, url) => {
      const addr = addrOf(url);
      let index = order.get(addr);
      if (index === undefined) {
        index = order.size;
        order.set(addr, index);
      }
      return index % 2 === 0 ? funded(900 + index) : respond(404, 'no such endpoint');
    });
    const { sleep } = recordingSleep();

    const outcome = await provisionAccounts(
      { ...OPTIONS, accounts: 6, concurrency: 3 },
      { fetch, sleep, random: NO_JITTER },
    );

    expect(outcome.funded).toHaveLength(3);
    expect(outcome.failures).toHaveLength(3);

    // The survivors are complete and usable, not stubs standing in for a batch
    // that partly failed.
    for (const account of outcome.funded) {
      expect(Keypair.fromSecret(account.secret).publicKey()).toBe(account.publicKey);
      expect(account.fundedAtLedger).toBeGreaterThan(0);
    }

    for (const failure of outcome.failures) {
      expect(failure.stage).toBe('funding');
      expect(failure.publicKey).toMatch(/^G[A-Z2-7]{55}$/);
      expect(failure.message).toContain('404');
    }

    // Every requested account is accounted for exactly once, on one side or the
    // other — a partial run must not silently drop an attempt.
    const seen = [
      ...outcome.funded.map((account) => account.publicKey),
      ...outcome.failures.map((failure) => failure.publicKey),
    ];
    expect(new Set(seen).size).toBe(6);
  });

  it('reports a failure for every account when Friendbot refuses all of them', async () => {
    const { fetch } = recordingFetch(async () => respond(400, 'malformed addr'));

    const outcome = await provisionAccounts({ ...OPTIONS, accounts: 4, concurrency: 2 }, { fetch });

    expect(outcome.funded).toEqual([]);
    expect(outcome.failures).toHaveLength(4);
    expect(outcome.failures.every((failure) => failure.stage === 'funding')).toBe(true);
  });

  it('fails the account without a request when the configured URL will not parse', async () => {
    const { fetch, urls } = recordingFetch(async () => funded(1));

    const outcome = await provisionAccounts(
      { ...OPTIONS, accounts: 2, friendbotUrl: 'not-a-url' },
      { fetch },
    );

    expect(urls).toEqual([]);
    expect(outcome.funded).toEqual([]);
    expect(outcome.failures).toHaveLength(2);
    expect(outcome.failures[0]?.stage).toBe('funding');
    expect(outcome.failures[0]?.message).toContain('not a valid absolute URL');
  });
});

describe('provisionAccounts — retry classification', () => {
  it('retries a 429 and keeps the account that succeeds on the second attempt', async () => {
    const { fetch, urls } = recordingFetch(async (call) =>
      call === 0 ? respond(429, 'rate limited') : funded(4_242),
    );
    const { sleep, delays } = recordingSleep();

    const outcome = await provisionAccounts(
      { ...OPTIONS, accounts: 1 },
      { fetch, sleep, random: NO_JITTER },
    );

    expect(urls).toHaveLength(2);
    expect(outcome.failures).toEqual([]);
    expect(outcome.funded[0]?.fundedAtLedger).toBe(4_242);
    // One backoff, between the two attempts: half of the 100ms base window.
    expect(delays).toEqual([50]);
  });

  it('retries a 5xx', async () => {
    const { fetch, urls } = recordingFetch(async (call) =>
      call === 0 ? respond(503, 'unavailable') : funded(1),
    );
    const { sleep } = recordingSleep();

    const outcome = await provisionAccounts({ ...OPTIONS }, { fetch, sleep, random: NO_JITTER });

    expect(urls).toHaveLength(2);
    expect(outcome.funded).toHaveLength(1);
  });

  it('retries a dropped connection', async () => {
    const { fetch, urls } = recordingFetch(async (call) => {
      if (call === 0) throw new TypeError('fetch failed');
      return funded(1);
    });
    const { sleep } = recordingSleep();

    const outcome = await provisionAccounts({ ...OPTIONS }, { fetch, sleep, random: NO_JITTER });

    expect(urls).toHaveLength(2);
    expect(outcome.funded).toHaveLength(1);
  });

  it('does not retry a terminal 4xx', async () => {
    const { fetch, urls } = recordingFetch(async () => respond(403, 'forbidden'));
    const { sleep, delays } = recordingSleep();

    const outcome = await provisionAccounts({ ...OPTIONS }, { fetch, sleep, random: NO_JITTER });

    // One request, and no backoff: repeating a refusal only costs the run time.
    expect(urls).toHaveLength(1);
    expect(delays).toEqual([]);
    expect(outcome.failures[0]?.stage).toBe('funding');
    expect(outcome.failures[0]?.message).toContain('403');
  });

  it('gives up after maxAttempts on a persistently retryable failure', async () => {
    const { fetch, urls } = recordingFetch(async () => respond(429, 'slow down'));
    const { sleep, delays } = recordingSleep();

    const outcome = await provisionAccounts(
      { ...OPTIONS, maxAttempts: 4 },
      { fetch, sleep, random: NO_JITTER },
    );

    expect(urls).toHaveLength(4);
    // No trailing sleep after the attempt that ended it.
    expect(delays).toHaveLength(3);
    expect(outcome.funded).toEqual([]);
    expect(outcome.failures[0]?.message).toContain('after 4 attempts');
    expect(outcome.failures[0]?.message).toContain('429');
  });

  it('treats a repeated create of an already-funded account as funded', async () => {
    // What a retry after a timeout looks like: the first attempt did land, and
    // the account this reports on is funded and ready to sign.
    const { fetch } = recordingFetch(async () =>
      respond(400, JSON.stringify({ extras: { result_codes: { operations: ['op_already_exists'] } } })),
    );

    const outcome = await provisionAccounts({ ...OPTIONS }, { fetch });

    expect(outcome.failures).toEqual([]);
    expect(outcome.funded).toHaveLength(1);
    expect(outcome.funded[0]?.fundedAtLedger).toBeNull();
  });

  it('grows the backoff exponentially and caps it', async () => {
    const { fetch } = recordingFetch(async () => respond(500, 'boom'));
    const { sleep, delays } = recordingSleep();

    await provisionAccounts(
      { ...OPTIONS, maxAttempts: 4, baseBackoffMs: 100, maxBackoffMs: 150 },
      { fetch, sleep, random: NO_JITTER },
    );

    // Windows of 100, 200→150, 400→150; half of each with jitter pinned to zero.
    expect(delays).toEqual([50, 75, 75]);
  });

  it('keeps every jittered delay inside the upper half of its window', async () => {
    const { fetch } = recordingFetch(async () => respond(429, 'slow down'));
    const { sleep, delays } = recordingSleep();

    await provisionAccounts(
      { ...OPTIONS, accounts: 8, concurrency: 4, maxAttempts: 3, baseBackoffMs: 200, maxBackoffMs: 10_000 },
      { fetch, sleep },
    );

    const windows = [200, 400];
    expect(delays).toHaveLength(8 * windows.length);
    for (const delay of delays) {
      const window = windows.find((candidate) => delay <= candidate);
      expect(window).toBeDefined();
      expect(delay).toBeGreaterThanOrEqual((window ?? 0) / 2);
    }

    // Jitter with a real random source must not produce one identical schedule
    // for every account, or it is not decorrelating anything.
    expect(new Set(delays).size).toBeGreaterThan(1);
  });

  it('uses the documented default attempt count when none is configured', async () => {
    const { fetch, urls } = recordingFetch(async () => respond(429, 'slow down'));
    const { sleep } = recordingSleep();
    const { maxAttempts: _ignored, ...withoutPolicy } = OPTIONS;

    await provisionAccounts(withoutPolicy, { fetch, sleep, random: NO_JITTER });

    expect(urls).toHaveLength(DEFAULT_MAX_ATTEMPTS);
  });
});

describe('provisionAccounts — timeouts', () => {
  /** Never answers; rejects only once the module's own signal fires. */
  const hangingFetch: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('This operation was aborted')));
    });

  it('classifies its own timeout as retryable and retries it', async () => {
    const { sleep, delays } = recordingSleep();
    let calls = 0;
    const fetchLike: FetchLike = (url, init) => {
      calls += 1;
      return calls === 1 ? hangingFetch(url, init) : Promise.resolve(funded(88));
    };

    const outcome = await provisionAccounts(
      { ...OPTIONS, timeoutMs: 5, maxAttempts: 2 },
      { fetch: fetchLike, sleep, random: NO_JITTER },
    );

    expect(calls).toBe(2);
    expect(delays).toEqual([50]);
    expect(outcome.funded[0]?.fundedAtLedger).toBe(88);
  });

  it('reports the timeout when every attempt hangs', async () => {
    const { sleep, delays } = recordingSleep();
    let calls = 0;
    const fetchLike: FetchLike = (url, init) => {
      calls += 1;
      return hangingFetch(url, init);
    };

    const outcome = await provisionAccounts(
      { ...OPTIONS, timeoutMs: 5, maxAttempts: 2 },
      { fetch: fetchLike, sleep, random: NO_JITTER },
    );

    expect(calls).toBe(2);
    expect(delays).toHaveLength(1);
    expect(outcome.funded).toEqual([]);
    expect(outcome.failures[0]?.stage).toBe('funding');
    expect(outcome.failures[0]?.message).toContain('did not answer within 5ms');
  });

  it('passes an unaborted AbortSignal into every request', async () => {
    const signals: AbortSignal[] = [];
    const fetchLike: FetchLike = async (_url, init) => {
      signals.push(init.signal);
      expect(init.signal.aborted).toBe(false);
      return funded(1);
    };

    await provisionAccounts({ ...OPTIONS, accounts: 3, concurrency: 3 }, { fetch: fetchLike });

    expect(signals).toHaveLength(3);
    // One controller per request, not one shared across the batch — otherwise a
    // single slow account would abort its siblings.
    expect(new Set(signals).size).toBe(3);
  });

  it('does not stall the batch when one account hangs', async () => {
    const { sleep } = recordingSleep();
    let call = 0;
    const fetchLike: FetchLike = (url, init) => {
      call += 1;
      return call === 1 ? hangingFetch(url, init) : Promise.resolve(funded(1));
    };

    const outcome = await provisionAccounts(
      { ...OPTIONS, accounts: 4, concurrency: 2, timeoutMs: 5, maxAttempts: 2 },
      { fetch: fetchLike, sleep, random: NO_JITTER },
    );

    expect(outcome.funded).toHaveLength(4);
    expect(outcome.failures).toEqual([]);
  });
});

describe('provisionAccounts — bounded concurrency', () => {
  it('never exceeds the configured limit and reaches it', async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchLike: FetchLike = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
      inFlight -= 1;
      return funded(1);
    };

    const outcome = await provisionAccounts(
      { ...OPTIONS, accounts: 12, concurrency: 4 },
      { fetch: fetchLike },
    );

    expect(peak).toBe(4);
    expect(outcome.funded).toHaveLength(12);
  });

  it('holds the limit while accounts retry at different rates', async () => {
    let inFlight = 0;
    let peak = 0;
    let call = 0;
    const fetchLike: FetchLike = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
      inFlight -= 1;
      call += 1;
      return call % 3 === 0 ? respond(429, 'slow down') : funded(1);
    };
    const { sleep } = recordingSleep();

    const outcome = await provisionAccounts(
      { ...OPTIONS, accounts: 20, concurrency: 3, maxAttempts: 3 },
      { fetch: fetchLike, sleep, random: NO_JITTER },
    );

    expect(peak).toBeLessThanOrEqual(3);
    expect(outcome.funded.length + outcome.failures.length).toBe(20);
  });

  it('does not start more workers than there are accounts', async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchLike: FetchLike = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
      inFlight -= 1;
      return funded(1);
    };

    await provisionAccounts({ ...OPTIONS, accounts: 3, concurrency: 50 }, { fetch: fetchLike });

    expect(peak).toBe(3);
  });

  it('still runs one at a time for a nonsensical concurrency', async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchLike: FetchLike = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
      inFlight -= 1;
      return funded(1);
    };

    const outcome = await provisionAccounts(
      { ...OPTIONS, accounts: 4, concurrency: 0 },
      { fetch: fetchLike },
    );

    expect(peak).toBe(1);
    expect(outcome.funded).toHaveLength(4);
  });
});

describe('provisionAccounts — ledger reporting', () => {
  it('records null rather than inventing a ledger when the body omits one', async () => {
    const { fetch } = recordingFetch(async () => respond(200, JSON.stringify({ hash: 'abc' })));

    const outcome = await provisionAccounts({ ...OPTIONS }, { fetch });

    expect(outcome.funded[0]?.fundedAtLedger).toBeNull();
  });

  it('records null for a body that is not JSON at all', async () => {
    const { fetch } = recordingFetch(async () => respond(200, '<html>ok</html>'));

    const outcome = await provisionAccounts({ ...OPTIONS }, { fetch });

    expect(outcome.funded).toHaveLength(1);
    expect(outcome.funded[0]?.fundedAtLedger).toBeNull();
  });

  it('records null for an empty body, and still counts the account as funded', async () => {
    const { fetch } = recordingFetch(async () => respond(200));

    const outcome = await provisionAccounts({ ...OPTIONS }, { fetch });

    expect(outcome.funded).toHaveLength(1);
    expect(outcome.funded[0]?.fundedAtLedger).toBeNull();
  });

  it('accepts a ledger sent as a numeric string', async () => {
    const { fetch } = recordingFetch(async () => respond(200, JSON.stringify({ ledger: '31337' })));

    const outcome = await provisionAccounts({ ...OPTIONS }, { fetch });

    expect(outcome.funded[0]?.fundedAtLedger).toBe(31_337);
  });

  it.each<[string, { ledger: unknown }]>([
    ['non-numeric', { ledger: 'soon' }],
    ['zero', { ledger: 0 }],
    ['negative', { ledger: -5 }],
    ['fractional', { ledger: 12.5 }],
    ['null', { ledger: null }],
  ])('records null for a %s ledger', async (_label, body) => {
    const { fetch } = recordingFetch(async () => respond(200, JSON.stringify(body)));

    const outcome = await provisionAccounts({ ...OPTIONS }, { fetch });

    expect(outcome.funded[0]?.fundedAtLedger).toBeNull();
  });

  it('counts the account as funded when the body cannot be read at all', async () => {
    const { fetch } = recordingFetch(async () => ({
      ok: true,
      status: 200,
      text: async () => {
        throw new Error('stream closed');
      },
    }));

    const outcome = await provisionAccounts({ ...OPTIONS }, { fetch });

    expect(outcome.funded).toHaveLength(1);
    expect(outcome.funded[0]?.fundedAtLedger).toBeNull();
  });
});

describe('provisionAccounts — secret handling', () => {
  it('redacts anything seed-shaped that a response body echoes back', async () => {
    // A hostile or buggy faucet quoting a seed in its error text is the exact
    // path by which a secret would otherwise reach a report.
    const decoy = Keypair.random().secret();
    const { fetch } = recordingFetch(async () => respond(400, `rejected seed ${decoy} for addr`));

    const outcome = await provisionAccounts({ ...OPTIONS, accounts: 3, concurrency: 2 }, { fetch });

    expect(outcome.failures).toHaveLength(3);
    for (const failure of outcome.failures) {
      expect(failure.message).not.toContain(decoy);
      expect(failure.message).toContain(REDACTED);
      expect(failure.message).not.toMatch(SEED_SHAPE);
    }
  });

  it('redacts a seed carried on a thrown transport error', async () => {
    const decoy = Keypair.random().secret();
    const { fetch } = recordingFetch(async () => {
      throw new Error(`connect ECONNREFUSED while sending ${decoy}`);
    });
    const { sleep } = recordingSleep();

    const outcome = await provisionAccounts(
      { ...OPTIONS, maxAttempts: 1 },
      { fetch, sleep, random: NO_JITTER },
    );

    expect(outcome.failures[0]?.message).not.toContain(decoy);
    expect(outcome.failures[0]?.message).not.toMatch(SEED_SHAPE);
  });

  it('keeps every minted secret out of the failure record of a mixed batch', async () => {
    const { fetch } = recordingFetch(async (call) =>
      call % 2 === 0 ? funded(600 + call) : respond(422, 'unprocessable'),
    );

    const outcome = await provisionAccounts({ ...OPTIONS, accounts: 8, concurrency: 1 }, { fetch });

    // Not vacuous: the run really did mint usable secrets.
    expect(outcome.funded.length).toBeGreaterThan(0);
    expect(outcome.failures.length).toBeGreaterThan(0);

    const record = JSON.stringify(outcome.failures);
    for (const account of outcome.funded) {
      expect(account.secret).toMatch(/^S[A-Z2-7]{55}$/);
      expect(record).not.toContain(account.secret);
    }

    // Nothing seed-shaped anywhere in the failure record, whether it came from
    // this run's keypairs or from a response body.
    expect(record).not.toMatch(SEED_SHAPE);
  });

  it('never puts a Friendbot URL into a message, since one carries a query string', async () => {
    const { fetch } = recordingFetch(async () => respond(404, 'not found'));

    const outcome = await provisionAccounts({ ...OPTIONS, accounts: 2 }, { fetch });

    for (const failure of outcome.failures) {
      expect(failure.message).not.toContain('friendbot.example');
      expect(failure.message).not.toContain('addr=');
      expect(failure.message).not.toContain('http');
    }
  });

  it('exposes a sentinel address on the stages that cannot have one', async () => {
    // Nothing here can force a keypair failure without breaking the runtime's
    // entropy, so this pins the contract the `keypair` stage promises instead:
    // a fabricated `G…` is never what a report will show.
    expect(UNKNOWN_PUBLIC_KEY).not.toMatch(/^G/);
    expect(UNKNOWN_PUBLIC_KEY.length).toBeLessThan(56);
  });
});
