import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  clientKey,
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
  it('takes the first hop of a multi-value x-forwarded-for and trims it', () => {
    const request = new Request('https://example.test/api', {
      headers: { 'x-forwarded-for': ' 203.0.113.5 , 198.51.100.7, 70.41.3.18' },
    });

    expect(clientKey(request, 'proof')).toBe('proof:203.0.113.5');
  });

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    const request = new Request('https://example.test/api', {
      headers: { 'x-real-ip': ' 198.51.100.7 ' },
    });

    const key = clientKey(request, 'proof');
    expect(key).toBe('proof:198.51.100.7');
    expect(key.startsWith('proof:')).toBe(true);
  });

  it('falls back to cf-connecting-ip when the other headers are absent', () => {
    const request = new Request('https://example.test/api', {
      headers: { 'cf-connecting-ip': '70.41.3.18' },
    });

    expect(clientKey(request, 'verify')).toBe('verify:70.41.3.18');
  });

  it('uses "unknown" when no IP header is present', () => {
    const request = new Request('https://example.test/api');

    expect(clientKey(request, 'verify')).toBe('verify:unknown');
  });

  it('keys the same IP differently per scope so routes do not share a bucket', () => {
    const headers = { 'x-forwarded-for': '203.0.113.5' };
    const proof = clientKey(
      new Request('https://example.test/api', { headers }),
      'proof',
    );
    const verify = clientKey(
      new Request('https://example.test/api', { headers }),
      'verify',
    );

    expect(proof).not.toBe(verify);
    expect(proof).toBe('proof:203.0.113.5');
    expect(verify).toBe('verify:203.0.113.5');

    const options = { limit: 1, windowMs: WINDOW_MS };
    expect(rateLimit(proof, options).ok).toBe(true);
    expect(rateLimit(proof, options).ok).toBe(false);
    expect(rateLimit(verify, options).ok).toBe(true);
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
