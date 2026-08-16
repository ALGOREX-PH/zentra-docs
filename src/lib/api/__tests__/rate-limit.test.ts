import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiError } from '@/lib/api/errors';
import {
  clientKey,
  countRequest,
  enforceRateLimit,
  rateLimit,
  rateLimitHeaders,
  resetRateLimiter,
} from '@/lib/api/rate-limit';

const WINDOW_MS = 60_000;

beforeEach(() => {
  resetRateLimiter();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('rateLimit', () => {
  it('allows every call under the limit and counts remaining down to zero', () => {
    const options = { limit: 4, windowMs: WINDOW_MS };
    const remaining: number[] = [];

    for (let i = 0; i < options.limit; i += 1) {
      const result = rateLimit('under-limit', options);
      expect(result.ok).toBe(true);
      expect(result.limit).toBe(4);
      expect(result.retryAfterSeconds).toBe(0);
      remaining.push(result.remaining);
    }

    expect(remaining).toEqual([3, 2, 1, 0]);
  });

  it('rejects the call past the limit with a retry-after of at least a second', () => {
    const options = { limit: 3, windowMs: WINDOW_MS };
    for (let i = 0; i < options.limit; i += 1) {
      expect(rateLimit('over-limit', options).ok).toBe(true);
    }

    const blocked = rateLimit('over-limit', options);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('keeps a blocked key blocked on subsequent calls inside the window', () => {
    const options = { limit: 1, windowMs: WINDOW_MS };
    expect(rateLimit('sticky', options).ok).toBe(true);
    expect(rateLimit('sticky', options).ok).toBe(false);
    expect(rateLimit('sticky', options).ok).toBe(false);
  });

  it('counts each key independently', () => {
    const options = { limit: 2, windowMs: WINDOW_MS };

    expect(rateLimit('a', options).ok).toBe(true);
    expect(rateLimit('a', options).ok).toBe(true);
    expect(rateLimit('a', options).ok).toBe(false);

    const first = rateLimit('b', options);
    expect(first.ok).toBe(true);
    expect(first.remaining).toBe(1);
  });

  it('starts a fresh window once the old one has expired', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const options = { limit: 2, windowMs: WINDOW_MS };
    const opening = rateLimit('rollover', options);
    expect(opening.ok).toBe(true);
    expect(rateLimit('rollover', options).ok).toBe(true);

    const blocked = rateLimit('rollover', options);
    expect(blocked.ok).toBe(false);

    vi.advanceTimersByTime(WINDOW_MS + 1);

    const reopened = rateLimit('rollover', options);
    expect(reopened.ok).toBe(true);
    expect(reopened.remaining).toBe(1);
    expect(reopened.retryAfterSeconds).toBe(0);
    expect(reopened.resetAt).toBeGreaterThan(opening.resetAt);
  });

  it('holds the window steady while time advances inside it', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const options = { limit: 2, windowMs: WINDOW_MS };
    const first = rateLimit('partial', options);

    vi.advanceTimersByTime(WINDOW_MS - 1);

    const second = rateLimit('partial', options);
    expect(second.ok).toBe(true);
    expect(second.remaining).toBe(0);
    expect(second.resetAt).toBe(first.resetAt);
    expect(rateLimit('partial', options).ok).toBe(false);
  });

  it('reports a resetAt in the future and no further away than the window', () => {
    const before = Date.now();
    const result = rateLimit('reset-at', { limit: 5, windowMs: WINDOW_MS });
    const after = Date.now();

    expect(result.resetAt).toBeGreaterThan(before);
    expect(result.resetAt).toBeLessThanOrEqual(after + WINDOW_MS);
  });
});

describe('clientKey', () => {
  /** Build a request carrying `headers` and nothing else the limiter reads. */
  function requestWith(headers: Record<string, string>): Request {
    return new Request('https://example.test/api', { headers });
  }

  it('takes the last hop of a multi-value x-forwarded-for, not the first', () => {
    // The leftmost entry is whatever the caller sent; only the rightmost was
    // written by the proxy that accepted the connection.
    const spoofed = clientKey(
      requestWith({ 'x-forwarded-for': ' 10.0.0.1 , 10.0.0.2, 203.0.113.5' }),
      'proof',
    );
    const plain = clientKey(requestWith({ 'x-forwarded-for': '203.0.113.5' }), 'proof');

    expect(spoofed).toBe(plain);
  });

  it('gives a caller no way to change its own bucket by prepending hops', () => {
    const options = { limit: 1, windowMs: WINDOW_MS };
    const first = clientKey(requestWith({ 'x-forwarded-for': '203.0.113.5' }), 'write');
    const second = clientKey(
      requestWith({ 'x-forwarded-for': `${'9.9.9.9, '.repeat(5)}203.0.113.5` }),
      'write',
    );

    expect(rateLimit(first, options).ok).toBe(true);
    expect(rateLimit(second, options).ok).toBe(false);
  });

  it('prefers the platform headers over x-forwarded-for entirely', () => {
    const trusted = clientKey(requestWith({ 'x-real-ip': '198.51.100.7' }), 'proof');
    const withDecoy = clientKey(
      requestWith({ 'x-real-ip': '198.51.100.7', 'x-forwarded-for': '203.0.113.5' }),
      'proof',
    );

    expect(withDecoy).toBe(trusted);
  });

  it('orders the platform headers vercel, cloudflare, then x-real-ip', () => {
    const vercel = clientKey(requestWith({ 'x-vercel-forwarded-for': '198.51.100.7' }), 'proof');
    const shadowed = clientKey(
      requestWith({
        'x-vercel-forwarded-for': '198.51.100.7',
        'cf-connecting-ip': '70.41.3.18',
        'x-real-ip': '10.0.0.1',
      }),
      'proof',
    );

    expect(shadowed).toBe(vercel);
  });

  it('falls back to cf-connecting-ip when the other trusted headers are absent', () => {
    const key = clientKey(requestWith({ 'cf-connecting-ip': '70.41.3.18' }), 'verify');

    expect(key).toBe(clientKey(requestWith({ 'cf-connecting-ip': ' 70.41.3.18 ' }), 'verify'));
    expect(key.startsWith('verify:')).toBe(true);
  });

  it('buckets every unidentifiable caller together', () => {
    const anonymous = clientKey(new Request('https://example.test/api'), 'verify');
    const blank = clientKey(requestWith({ 'x-forwarded-for': '   ' }), 'verify');

    expect(blank).toBe(anonymous);
  });

  it('separates two different addresses', () => {
    const a = clientKey(requestWith({ 'x-real-ip': '203.0.113.5' }), 'proof');
    const b = clientKey(requestWith({ 'x-real-ip': '203.0.113.6' }), 'proof');

    expect(a).not.toBe(b);
  });

  it('never returns the raw address it was derived from', () => {
    const key = clientKey(requestWith({ 'x-real-ip': '203.0.113.5' }), 'proof');

    expect(key).not.toContain('203.0.113.5');
    expect(key).toBe('proof:91cf7406236023d6');
  });

  it('holds the key to a fixed width however long the header is', () => {
    const short = clientKey(requestWith({ 'x-real-ip': '1.2.3.4' }), 'proof');
    const long = clientKey(requestWith({ 'x-real-ip': 'a'.repeat(8000) }), 'proof');

    expect(long).toHaveLength(short.length);
  });

  it('cannot be steered into another scope by an address containing a colon', () => {
    const injected = clientKey(requestWith({ 'x-real-ip': 'write:203.0.113.5' }), 'feedback');
    const target = clientKey(requestWith({ 'x-real-ip': '203.0.113.5' }), 'feedback:write');

    expect(injected).not.toBe(target);
  });

  it('keys the same address differently per scope so routes do not share a bucket', () => {
    const headers = { 'x-real-ip': '203.0.113.5' };
    const proof = clientKey(requestWith(headers), 'proof');
    const verify = clientKey(requestWith(headers), 'verify');

    expect(proof).not.toBe(verify);

    const options = { limit: 1, windowMs: WINDOW_MS };
    expect(rateLimit(proof, options).ok).toBe(true);
    expect(rateLimit(proof, options).ok).toBe(false);
    expect(rateLimit(verify, options).ok).toBe(true);
  });

  it('is stable across calls for the same address', () => {
    const headers = { 'x-real-ip': '203.0.113.5' };

    expect(clientKey(requestWith(headers), 'proof')).toBe(clientKey(requestWith(headers), 'proof'));
  });
});

describe('rateLimitHeaders', () => {
  it('emits the three X-RateLimit headers as strings', () => {
    const result = rateLimit('headers', { limit: 10, windowMs: WINDOW_MS });
    const headers = rateLimitHeaders(result);

    expect(Object.keys(headers).sort()).toEqual([
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
    ]);
    for (const value of Object.values(headers)) {
      expect(typeof value).toBe('string');
    }
    expect(headers['X-RateLimit-Limit']).toBe('10');
    expect(headers['X-RateLimit-Remaining']).toBe('9');
  });

  it('reports the reset as epoch seconds rather than milliseconds', () => {
    const result = rateLimit('headers-reset', { limit: 1, windowMs: WINDOW_MS });
    const headers = rateLimitHeaders(result);

    expect(headers['X-RateLimit-Reset']).toBe(String(Math.ceil(result.resetAt / 1000)));
    expect(headers['X-RateLimit-Reset']).not.toBe(String(result.resetAt));

    // Bounded explicitly rather than with toBeCloseTo: rounding up can move the
    // value by nearly a full second, which is wider than a 0-digit closeness
    // check permits, so that form failed on roughly half of all wall clocks.
    const seconds = Number(headers['X-RateLimit-Reset']);
    expect(seconds).toBeGreaterThanOrEqual(result.resetAt / 1000);
    expect(seconds - result.resetAt / 1000).toBeLessThan(1);
  });
});

describe('enforceRateLimit', () => {
  /** A request whose caller the platform vouches for, so keys are stable. */
  function requestFrom(ip: string): Request {
    return new Request('https://x.test/api', { headers: { 'x-real-ip': ip } });
  }

  it('returns the X-RateLimit headers while the caller is under the limit', () => {
    const headers = enforceRateLimit(requestFrom('1.2.3.4'), 'test:write', {
      limit: 2,
      windowMs: WINDOW_MS,
    });

    expect(headers['X-RateLimit-Limit']).toBe('2');
    expect(headers['X-RateLimit-Remaining']).toBe('1');
  });

  it('throws a 429 ApiError carrying retryAfterSeconds once the limit is hit', () => {
    const options = { limit: 1, windowMs: WINDOW_MS };
    enforceRateLimit(requestFrom('1.2.3.5'), 'test:write', options);

    let caught: unknown;
    try {
      enforceRateLimit(requestFrom('1.2.3.5'), 'test:write', options);
    } catch (error) {
      caught = error;
    }

    const err = caught as ApiError;
    expect(err.status).toBe(429);
    expect(err.code).toBe('rate_limited');
    expect(err.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('scopes counters, so the same caller has a separate budget per scope', () => {
    const options = { limit: 1, windowMs: WINDOW_MS };
    enforceRateLimit(requestFrom('1.2.3.6'), 'test:write', options);

    expect(() => enforceRateLimit(requestFrom('1.2.3.6'), 'other:write', options)).not.toThrow();
  });
});

describe('countRequest', () => {
  function requestFrom(ip: string): Request {
    return new Request('https://x.test/api', { headers: { 'x-real-ip': ip } });
  }

  it('returns nothing while under the limit — the budget stays off cacheable responses', () => {
    expect(
      countRequest(requestFrom('2.3.4.5'), 'test:read', { limit: 2, windowMs: WINDOW_MS }),
    ).toBeUndefined();
  });

  it('throws the same 429 as enforceRateLimit once the limit is hit', () => {
    const options = { limit: 1, windowMs: WINDOW_MS };
    countRequest(requestFrom('2.3.4.6'), 'test:read', options);

    let caught: unknown;
    try {
      countRequest(requestFrom('2.3.4.6'), 'test:read', options);
    } catch (error) {
      caught = error;
    }

    expect((caught as ApiError).status).toBe(429);
    expect((caught as ApiError).code).toBe('rate_limited');
  });
});

describe('resetRateLimiter', () => {
  it('clears the store so an exhausted key is allowed again', () => {
    const options = { limit: 2, windowMs: WINDOW_MS };
    expect(rateLimit('cleared', options).ok).toBe(true);
    expect(rateLimit('cleared', options).ok).toBe(true);
    expect(rateLimit('cleared', options).ok).toBe(false);

    resetRateLimiter();

    const afterReset = rateLimit('cleared', options);
    expect(afterReset.ok).toBe(true);
    expect(afterReset.remaining).toBe(1);
  });
});
