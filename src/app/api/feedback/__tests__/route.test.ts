import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DELETE, GET, PATCH, POST, PUT } from '@/app/api/feedback/route';
import { resetRateLimiter } from '@/lib/api/rate-limit';
import { READ_CACHE_CONTROL } from '@/lib/api/route';
import { verifyAnchor } from '@/lib/api/verify-anchor';
import { query, sql } from '@/lib/db';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  sql: vi.fn(),
}));

vi.mock('@/lib/api/verify-anchor', () => ({
  verifyAnchor: vi.fn(),
}));

const queryMock = query as unknown as ReturnType<typeof vi.fn>;
const sqlMock = sql as unknown as ReturnType<typeof vi.fn>;
const verifyAnchorMock = vi.mocked(verifyAnchor);

const WALLET = `G${'A'.repeat(55)}`;
const TX_HASH = 'ab12'.repeat(16);

/** One statement the handler issued through the mocked seam. */
interface Captured {
  text: string;
  values: unknown[];
}

/** Route every `sql()` tagged call into `captured`, resolving with `rows`. */
function captureInserts(rows: unknown[] = []): Captured[] {
  const captured: Captured[] = [];
  sqlMock.mockReturnValue((strings: TemplateStringsArray, ...values: unknown[]) => {
    captured.push({ text: strings.join('$'), values });
    return Promise.resolve(rows);
  });
  return captured;
}

/** Make every `sql()` tagged call reject with `error`. */
function failInsert(error: unknown): void {
  sqlMock.mockReturnValue(() => Promise.reject(error));
}

let ipCounter = 0;

/** A JSON POST from a fresh address, so tests never share a rate bucket. */
function post(body: unknown, headers: Record<string, string> = {}): Request {
  ipCounter += 1;
  return new Request('https://docs.zentra.dev/api/feedback', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-real-ip': `10.1.${Math.floor(ipCounter / 200)}.${ipCounter % 200}`,
      ...headers,
    },
  });
}

function get(): Request {
  ipCounter += 1;
  return new Request('https://docs.zentra.dev/api/feedback', {
    headers: { 'x-real-ip': `10.2.${Math.floor(ipCounter / 200)}.${ipCounter % 200}` },
  });
}

beforeEach(() => {
  resetRateLimiter();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  queryMock.mockReset();
  sqlMock.mockReset();
  verifyAnchorMock.mockReset();
});

describe('POST /api/feedback', () => {
  it('stores a clean comment visible and answers 201 with rate-limit headers', async () => {
    const inserts = captureInserts();

    const response = await POST(post({ rating: 5, comment: 'Proof verified instantly.' }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('X-RateLimit-Limit')).toBe('5');
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('4');

    expect(inserts).toHaveLength(1);
    const [insert] = inserts;
    expect(insert?.text).toContain('INSERT INTO feedback');
    // Values in statement order: rating, comment, wallet, tx_hash, on_chain, hidden.
    expect(insert?.values).toEqual([5, 'Proof verified instantly.', null, null, false, false]);
  });

  it('stores a moderation-withheld comment with hidden=true and still answers 201', async () => {
    const inserts = captureInserts();

    const response = await POST(post({ rating: 1, comment: 'This is fucking broken.' }));

    // Screened, not refused: the submitter learns nothing about the filter.
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.values[1]).toBe('This is fucking broken.');
    expect(inserts[0]?.values[5]).toBe(true);
  });

  it('downgrades an unverified anchor: stored onChain false AND txHash null', async () => {
    const inserts = captureInserts();
    verifyAnchorMock.mockResolvedValue({ verified: false, reason: 'wrong_account' });

    const response = await POST(
      post({ rating: 5, comment: 'Anchored.', wallet: WALLET, txHash: TX_HASH, onChain: true }),
    );

    // The feedback is kept; only the unearned badge and its hash are dropped,
    // so an invented hash can never occupy the unique per-transaction index.
    expect(response.status).toBe(201);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.values).toEqual([5, 'Anchored.', WALLET, null, false, false]);
  });

  it('stores a verified anchor with onChain true and the lowercased hash', async () => {
    const inserts = captureInserts();
    verifyAnchorMock.mockResolvedValue({ verified: true, sourceAccount: WALLET });

    const response = await POST(
      post({
        rating: 5,
        comment: 'Anchored.',
        wallet: WALLET,
        txHash: TX_HASH.toUpperCase(),
        onChain: true,
      }),
    );

    expect(response.status).toBe(201);
    expect(verifyAnchorMock).toHaveBeenCalledWith(TX_HASH, WALLET, expect.any(String));
    expect(inserts[0]?.values).toEqual([5, 'Anchored.', WALLET, TX_HASH, true, false]);
  });

  it('never consults Horizon when nothing claims to be on-chain', async () => {
    captureInserts();

    await POST(post({ rating: 4, comment: 'Off-chain feedback.' }));

    expect(verifyAnchorMock).not.toHaveBeenCalled();
  });

  it('answers 422 when an on-chain claim names no wallet', async () => {
    const inserts = captureInserts();

    const response = await POST(
      post({ rating: 5, comment: 'Anchored.', txHash: TX_HASH, onChain: true }),
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details.wallet).toBe('Wallet is required when onChain is true.');
    expect(inserts).toHaveLength(0);
    expect(verifyAnchorMock).not.toHaveBeenCalled();
  });

  it('maps a unique violation to a 409 conflict envelope', async () => {
    failInsert({ code: '23505' });
    verifyAnchorMock.mockResolvedValue({ verified: true, sourceAccount: WALLET });

    const response = await POST(
      post({ rating: 5, comment: 'Anchored.', wallet: WALLET, txHash: TX_HASH, onChain: true }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: { code: 'conflict', message: 'This transaction has already been recorded.' },
    });
  });

  it('maps any other storage failure to a 503 that leaks nothing', async () => {
    failInsert(new Error('connect ECONNREFUSED postgres://user:pw@host/db'));

    const response = await POST(post({ rating: 3, comment: 'Fine.' }));
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(text).not.toContain('postgres');
    expect(text).not.toContain('ECONNREFUSED');
    expect(JSON.parse(text).error.message).toBe('Feedback storage is temporarily unavailable.');
  });

  it('answers the request past the write limit with a 429 and Retry-After', async () => {
    captureInserts();
    const headers = { 'x-real-ip': '10.9.9.9' };
    for (let i = 0; i < 5; i += 1) {
      const response = await POST(post({ rating: 4, comment: 'Again.' }, headers));
      expect(response.status).toBe(201);
    }

    const blocked = await POST(post({ rating: 4, comment: 'Again.' }, headers));
    const body = await blocked.json();

    expect(blocked.status).toBe(429);
    expect(body.error.code).toBe('rate_limited');
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
    expect(blocked.headers.get('cache-control')).toBe('no-store');
  });

  it('refuses a cross-origin submission before touching storage', async () => {
    const inserts = captureInserts();

    const response = await POST(
      post(
        { rating: 5, comment: 'Hijacked.' },
        { origin: 'https://evil.test', host: 'docs.zentra.dev' },
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('forbidden');
    expect(inserts).toHaveLength(0);
  });

  it('refuses a non-JSON content type with a 415', async () => {
    const response = await POST(
      post('rating=5', { 'content-type': 'application/x-www-form-urlencoded' }),
    );
    const body = await response.json();

    expect(response.status).toBe(415);
    expect(body.error.code).toBe('unsupported_media_type');
  });
});

describe('GET /api/feedback', () => {
  /** Rows for the two statements the read issues, told apart by their SQL. */
  function stubRead(summary: unknown, recent: unknown[]): void {
    queryMock.mockImplementation((strings: TemplateStringsArray) => {
      const text = strings.join(' ');
      return Promise.resolve(text.includes('count(*)') ? [summary] : recent);
    });
  }

  it('returns the summary plus recent rows with the shared read cache policy', async () => {
    const recentRow = {
      rating: 5,
      comment: 'Great.',
      wallet: null,
      txHash: null,
      onChain: false,
      createdAt: '2026-08-01T00:00:00.000Z',
    };
    stubRead({ count: 2, average: 4.5, onChain: 1 }, [recentRow]);

    const response = await GET(get());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ count: 2, average: 4.5, onChain: 1, recent: [recentRow] });
    expect(response.headers.get('cache-control')).toBe(READ_CACHE_CONTROL);
    expect(response.headers.get('cache-control')).toContain('public, s-maxage');
  });

  it('excludes hidden rows from both the summary and the recent list', async () => {
    stubRead({ count: 0, average: 0, onChain: 0 }, []);

    await GET(get());

    // Both statements filter on NOT hidden — a withheld comment must not
    // inflate the count or drag the average either.
    expect(queryMock).toHaveBeenCalledTimes(2);
    for (const call of queryMock.mock.calls) {
      expect((call[0] as TemplateStringsArray).join(' ')).toContain('WHERE NOT hidden');
    }
  });

  it('carries no per-caller X-RateLimit headers on the cacheable response', async () => {
    stubRead({ count: 0, average: 0, onChain: 0 }, []);

    const response = await GET(get());

    // The response is publicly cached; one caller's remaining budget must not
    // be stored and replayed to everybody else.
    expect(response.headers.get('X-RateLimit-Limit')).toBeNull();
    expect(response.headers.get('X-RateLimit-Remaining')).toBeNull();
    expect(response.headers.get('X-RateLimit-Reset')).toBeNull();
  });

  it('maps a read failure to a 503 with the route message only', async () => {
    queryMock.mockImplementation(() => Promise.reject(new Error('relation does not exist')));

    const response = await GET(get());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe('upstream_unavailable');
    expect(body.error.message).toBe('Feedback storage is temporarily unavailable.');
  });
});

describe('unsupported methods on /api/feedback', () => {
  it('answers PUT, PATCH and DELETE with an enveloped 405 naming GET and POST', async () => {
    for (const handler of [PUT, PATCH, DELETE]) {
      const response = await handler(new Request('https://docs.zentra.dev/api/feedback'));
      const body = await response.json();

      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('GET, POST');
      expect(body.error.code).toBe('method_not_allowed');
    }
  });
});
