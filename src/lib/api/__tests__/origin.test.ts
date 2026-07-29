import { describe, expect, it, vi } from 'vitest';
import type { ApiError } from '@/lib/api/errors';
import { requireSameOrigin } from '@/lib/api/origin';

const REQUEST_ID = 'test-request-id';

/** Build a POST carrying the given headers, which is all the gate reads. */
function post(headers: Record<string, string>): Request {
  return new Request('https://docs.zentra.dev/api/feedback', {
    method: 'POST',
    headers,
  });
}

/** Run the gate on a request expected to be refused and return the error. */
function refusal(request: Request): ApiError {
  try {
    requireSameOrigin(request, REQUEST_ID);
  } catch (error) {
    return error as ApiError;
  }
  throw new Error('Expected requireSameOrigin to throw, but it returned.');
}

describe('requireSameOrigin', () => {
  it('allows a request with no origin header at all', () => {
    expect(() => requireSameOrigin(post({ host: 'docs.zentra.dev' }), REQUEST_ID)).not.toThrow();
  });

  it('allows an origin matching the host header', () => {
    const request = post({ host: 'docs.zentra.dev', origin: 'https://docs.zentra.dev' });

    expect(() => requireSameOrigin(request, REQUEST_ID)).not.toThrow();
  });

  it('allows an origin whose scheme differs from the one we were reached on', () => {
    // TLS terminates at the edge, so the function sees plain HTTP while the
    // browser reports https. Matching on scheme would refuse every real request.
    const request = post({ host: 'docs.zentra.dev', origin: 'http://docs.zentra.dev' });

    expect(() => requireSameOrigin(request, REQUEST_ID)).not.toThrow();
  });

  it('allows an origin matching x-forwarded-host when a proxy rewrote host', () => {
    const request = post({
      host: 'internal.vercel.app',
      'x-forwarded-host': 'docs.zentra.dev',
      origin: 'https://docs.zentra.dev',
    });

    expect(() => requireSameOrigin(request, REQUEST_ID)).not.toThrow();
  });

  it('takes the first entry of a comma-separated forwarded host', () => {
    const request = post({
      host: 'internal.vercel.app',
      'x-forwarded-host': 'docs.zentra.dev, internal.vercel.app',
      origin: 'https://docs.zentra.dev',
    });

    expect(() => requireSameOrigin(request, REQUEST_ID)).not.toThrow();
  });

  it('compares the port as part of the authority', () => {
    const local = post({ host: 'localhost:3000', origin: 'http://localhost:3000' });
    expect(() => requireSameOrigin(local, REQUEST_ID)).not.toThrow();

    const wrongPort = post({ host: 'localhost:3000', origin: 'http://localhost:4000' });
    expect(refusal(wrongPort).status).toBe(403);
  });

  it('refuses a cross-site origin with a 403', () => {
    const err = refusal(post({ host: 'docs.zentra.dev', origin: 'https://evil.test' }));

    expect(err.status).toBe(403);
    expect(err.code).toBe('forbidden');
  });

  it('refuses a subdomain of our host that is not our host', () => {
    const err = refusal(post({ host: 'docs.zentra.dev', origin: 'https://evil.docs.zentra.dev' }));

    expect(err.status).toBe(403);
  });

  it('refuses an origin that merely has our host as a prefix', () => {
    const err = refusal(post({ host: 'docs.zentra.dev', origin: 'https://docs.zentra.dev.evil.test' }));

    expect(err.status).toBe(403);
  });

  it('refuses the opaque origin a sandboxed iframe sends', () => {
    const err = refusal(post({ host: 'docs.zentra.dev', origin: 'null' }));

    expect(err.status).toBe(403);
  });

  it('refuses a non-http scheme', () => {
    const err = refusal(post({ host: 'docs.zentra.dev', origin: 'file://docs.zentra.dev' }));

    expect(err.status).toBe(403);
  });

  it('refuses an origin longer than the parse ceiling', () => {
    const err = refusal(
      post({ host: 'docs.zentra.dev', origin: `https://${'a'.repeat(4000)}.test` }),
    );

    expect(err.status).toBe(403);
  });

  it('refuses when no host header identifies us and the origin is not canonical', () => {
    const err = refusal(post({ origin: 'https://evil.test' }));

    expect(err.status).toBe(403);
  });

  it('never echoes the rejected origin into the log line or the message', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const err = refusal(post({ host: 'docs.zentra.dev', origin: 'https://secret.evil.test' }));

      expect(err.message).not.toContain('evil.test');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).not.toContain('evil.test');
      expect(String(warn.mock.calls[0]?.[0])).toContain(REQUEST_ID);
    } finally {
      warn.mockRestore();
    }
  });
});
