import { afterEach, describe, expect, it, vi } from 'vitest';
import { badRequest, rateLimited } from '@/lib/api/errors';
import { json, route } from '@/lib/api/route';

/** The shape of an id `newRequestId` mints: a UUID, or the base36 fallback. */
const MINTED_ID = /^[0-9a-z-]{16,}$/i;

/** Silence the wrapper's own log line; every request through it emits one. */
function muffle(): void {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('route request ids', () => {
  it('echoes a well-formed inbound x-request-id', async () => {
    muffle();
    const handler = route('test', async () => json({ ok: true }));

    const response = await handler(
      new Request('https://x.test/api', { headers: { 'x-request-id': 'trace-123:abc' } }),
    );

    expect(response.headers.get('x-request-id')).toBe('trace-123:abc');
  });

  it('accepts the id formats real tracing systems emit', async () => {
    muffle();
    const handler = route('test', async () => json({ ok: true }));

    for (const id of [
      '3f2b1c8e-9a4d-4f11-8b7e-2c6d5a4b3c2d',
      '4bf92f3577b34da6a3ce929d0e0e4736',
      'edge1:iad1:00427',
      'YWJjZGVmZ2g=',
    ]) {
      const response = await handler(
        new Request('https://x.test/api', { headers: { 'x-request-id': id } }),
      );

      expect(response.headers.get('x-request-id')).toBe(id);
    }
  });

  it('hands the same id to the handler that it returns to the caller', async () => {
    muffle();
    let seen = '';
    const handler = route('test', async (_request, { requestId }) => {
      seen = requestId;
      return json({ ok: true });
    });

    const response = await handler(new Request('https://x.test/api'));

    expect(seen).not.toBe('');
    expect(response.headers.get('x-request-id')).toBe(seen);
  });

  it('mints a fresh id when the inbound one is over the length cap', async () => {
    muffle();
    const handler = route('test', async () => json({ ok: true }));

    const response = await handler(
      new Request('https://x.test/api', { headers: { 'x-request-id': 'a'.repeat(201) } }),
    );

    expect(response.headers.get('x-request-id')).not.toContain('aaaa');
    expect(response.headers.get('x-request-id')).toMatch(MINTED_ID);
  });

  it('mints a fresh id rather than echoing anything that is not an identifier', async () => {
    muffle();
    const handler = route('test', async () => json({ ok: true }));

    // Every one of these is a value the transport will happily deliver, and
    // none of them is an id. Taken at face value they end up reflected into a
    // response header, into every log line, and into the health body.
    for (const hostile of [
      'has spaces',
      '<script>alert(1)</script>',
      '"quoted"',
      'semi;colon',
      '{"json":"fragment"}',
      'café',
    ]) {
      const response = await handler(
        new Request('https://x.test/api', { headers: { 'x-request-id': hostile } }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('x-request-id')).toMatch(MINTED_ID);
    }
  });

  it('mints a fresh id for a blank inbound header', async () => {
    muffle();
    const handler = route('test', async () => json({ ok: true }));

    const response = await handler(
      new Request('https://x.test/api', { headers: { 'x-request-id': '   ' } }),
    );

    expect(response.headers.get('x-request-id')).toMatch(MINTED_ID);
  });
});

describe('route error handling', () => {
  it('turns an ApiError into its envelope with the request id attached', async () => {
    muffle();
    const handler = route('test', async () => {
      throw badRequest('Missing body.');
    });

    const response = await handler(new Request('https://x.test/api'));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: 'bad_request', message: 'Missing body.' },
    });
    expect(response.headers.get('x-request-id')).toMatch(MINTED_ID);
  });

  it('collapses an unknown throw to a generic 500 that leaks nothing', async () => {
    muffle();
    const handler = route('test', async () => {
      throw new Error('connect ECONNREFUSED postgres://user:pw@host/db');
    });

    const response = await handler(new Request('https://x.test/api'));
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).not.toContain('postgres');
    expect(body).not.toContain('ECONNREFUSED');
    expect(JSON.parse(body)).toEqual({
      error: { code: 'internal', message: 'Internal server error.' },
    });
  });

  it('keeps Retry-After on a rate-limited error', async () => {
    muffle();
    const handler = route('test', async () => {
      throw rateLimited(42);
    });

    const response = await handler(new Request('https://x.test/api'));

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('42');
  });
});

describe('route cache headers', () => {
  it('never lets an error response be stored by a cache', async () => {
    muffle();

    for (const thrown of [badRequest('Missing body.'), rateLimited(30), new Error('boom')]) {
      const handler = route('test', async () => {
        throw thrown;
      });

      const response = await handler(new Request('https://x.test/api'));

      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('defaults a successful json response to no-store', async () => {
    muffle();
    const handler = route('test', async () => json({ ok: true }));

    const response = await handler(new Request('https://x.test/api'));

    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('lets a handler override the default with a deliberate policy', async () => {
    muffle();
    const handler = route('test', async () =>
      json({ ok: true }, { headers: { 'cache-control': 'public, s-maxage=30' } }),
    );

    const response = await handler(new Request('https://x.test/api'));

    expect(response.headers.get('cache-control')).toBe('public, s-maxage=30');
  });
});

describe('route logging', () => {
  it('logs one line carrying the request id and the status it answered with', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const handler = route('feedback.list', async () => json({ ok: true }));

    const response = await handler(
      new Request('https://x.test/api', { headers: { 'x-request-id': 'trace-1' } }),
    );

    expect(log).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(line.requestId).toBe('trace-1');
    expect(line.name).toBe('feedback.list');
    expect(line.status).toBe(response.status);
  });

  it('logs a failure at warn with the code it responded with', async () => {
    muffle();
    const warn = vi.spyOn(console, 'warn');
    const handler = route('feedback.create', async () => {
      throw badRequest('Missing body.');
    });

    await handler(new Request('https://x.test/api'));

    expect(warn).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(warn.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(line.code).toBe('bad_request');
    expect(line.status).toBe(400);
  });
});
