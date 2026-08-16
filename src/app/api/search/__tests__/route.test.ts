import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DELETE, GET, PATCH, POST, PUT } from '@/app/api/search/route';
import { resetRateLimiter } from '@/lib/api/rate-limit';

const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }));

// The index is assembled from the docs content at first use; neither the
// content pipeline nor Orama belongs in a route-behaviour test.
vi.mock('@/lib/source', () => ({ source: {} }));
vi.mock('fumadocs-core/search/server', () => ({
  createFromSource: vi.fn(() => ({ search: searchMock })),
}));

let ipCounter = 0;

/** A search GET for `params`, from a fresh address per call. */
function get(params: Record<string, string>): Request {
  ipCounter += 1;
  const url = new URL('https://docs.zentra.dev/api/search');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new Request(url, {
    headers: { 'x-real-ip': `10.9.${Math.floor(ipCounter / 200)}.${ipCounter % 200}` },
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
  searchMock.mockReset();
});

describe('GET /api/search', () => {
  it('answers an empty query with [] without ever touching the index', async () => {
    const response = await GET(get({}));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(searchMock).not.toHaveBeenCalled();
    // Cacheable hard: the dialog issues this exact request every time it opens.
    expect(response.headers.get('cache-control')).toBe(
      'public, s-maxage=300, stale-while-revalidate=3600',
    );
  });

  it('treats a whitespace-only query the same way', async () => {
    const response = await GET(get({ query: '   ' }));

    expect(await response.json()).toEqual([]);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('runs a real query against the index with the validated options', async () => {
    const results = [{ id: 'docs/proofs', content: 'Groth16' }];
    searchMock.mockResolvedValue(results);

    const response = await GET(get({ query: 'soroban', locale: 'en', tag: 'guide', limit: '10' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(results);
    expect(searchMock).toHaveBeenCalledWith('soroban', {
      locale: 'en',
      tag: ['guide'],
      limit: 10,
    });
  });

  it('carries no per-caller X-RateLimit headers on the cacheable response', async () => {
    searchMock.mockResolvedValue([]);

    const response = await GET(get({ query: 'wallet' }));

    expect(response.headers.get('X-RateLimit-Limit')).toBeNull();
    expect(response.headers.get('X-RateLimit-Remaining')).toBeNull();
  });

  it('refuses an unbounded query with the standard 422 envelope', async () => {
    const response = await GET(get({ query: 'a'.repeat(257) }));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details.query).toBeDefined();
    expect(searchMock).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('refuses a limit that would allocate an unbounded result set', async () => {
    const response = await GET(get({ query: 'x', limit: '1000000' }));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.details.limit).toBeDefined();
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('maps an index failure to a 503 that never quotes the query', async () => {
    searchMock.mockRejectedValue(new Error('orama schema mismatch on term supersecretquery'));

    const response = await GET(get({ query: 'supersecretquery' }));
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(text).error.message).toBe('Search is temporarily unavailable.');
    expect(text).not.toContain('supersecretquery');
    expect(text).not.toContain('orama');
  });
});

describe('unsupported methods on /api/search', () => {
  it('answers POST, PUT, PATCH and DELETE with an enveloped 405 naming GET', async () => {
    for (const handler of [POST, PUT, PATCH, DELETE]) {
      const response = await handler(new Request('https://docs.zentra.dev/api/search'));
      const body = await response.json();

      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('GET');
      expect(body.error.code).toBe('method_not_allowed');
    }
  });
});
