import { describe, expect, it } from 'vitest';
import {
  ApiError,
  badRequest,
  isApiError,
  payloadTooLarge,
  rateLimited,
  toErrorBody,
  upstreamUnavailable,
  validationFailed,
} from '@/lib/api/errors';

describe('badRequest', () => {
  it('produces a 400 with the bad_request code and the given message', () => {
    const err = badRequest('Missing body.');
    expect(err.status).toBe(400);
    expect(err.code).toBe('bad_request');
    expect(err.message).toBe('Missing body.');
  });
});

describe('validationFailed', () => {
  it('produces a 422 with the validation_failed code', () => {
    const err = validationFailed({ email: 'is required' });
    expect(err.status).toBe(422);
    expect(err.code).toBe('validation_failed');
  });

  it('carries its details through to toErrorBody', () => {
    const details = { email: 'is required', name: 'is too short' };
    const result = toErrorBody(validationFailed(details));
    expect(result.status).toBe(422);
    expect(result.body.error.code).toBe('validation_failed');
    expect(result.body.error.details).toEqual(details);
  });
});

describe('rateLimited', () => {
  it('produces a 429 with the rate_limited code', () => {
    const err = rateLimited(30);
    expect(err.status).toBe(429);
    expect(err.code).toBe('rate_limited');
    expect(err.retryAfterSeconds).toBe(30);
  });

  it('surfaces a Retry-After header from toErrorBody', () => {
    const result = toErrorBody(rateLimited(42));
    expect(result.status).toBe(429);
    expect(result.headers['Retry-After']).toBe('42');
  });
});

describe('payloadTooLarge', () => {
  it('produces a 413 with the payload_too_large code and names the limit', () => {
    const err = payloadTooLarge(1024);
    expect(err.status).toBe(413);
    expect(err.code).toBe('payload_too_large');
    expect(err.message).toContain('1024');
  });
});

describe('upstreamUnavailable', () => {
  it('produces a 503 with the upstream_unavailable code and the given message', () => {
    const err = upstreamUnavailable('Horizon is unreachable.');
    expect(err.status).toBe(503);
    expect(err.code).toBe('upstream_unavailable');
    expect(err.message).toBe('Horizon is unreachable.');
  });
});

describe('toErrorBody headers', () => {
  it('omits Retry-After for an error that is not rate limited', () => {
    const result = toErrorBody(badRequest('Missing body.'));
    expect(result.headers['Retry-After']).toBeUndefined();
    expect(Object.keys(result.headers)).toHaveLength(0);
  });

  it('omits details for an error that carries none', () => {
    const result = toErrorBody(badRequest('Missing body.'));
    expect(result.body.error.details).toBeUndefined();
    expect('details' in result.body.error).toBe(false);
  });
});

describe('isApiError', () => {
  it('is true for a real ApiError', () => {
    expect(isApiError(badRequest('nope'))).toBe(true);
  });

  it('is true for a structurally shaped plain object', () => {
    expect(isApiError({ status: 429, code: 'rate_limited' })).toBe(true);
  });

  it('is false for null', () => {
    expect(isApiError(null)).toBe(false);
  });

  it('is false for a string', () => {
    expect(isApiError('bad_request')).toBe(false);
  });

  it('is false for a bare Error', () => {
    expect(isApiError(new Error('x'))).toBe(false);
  });
});

describe('toErrorBody security', () => {
  it('never leaks the message of an unknown error', () => {
    const secret = 'connection to postgres://user:pw@host failed';
    const result = toErrorBody(new Error(secret));

    expect(result.status).toBe(500);
    expect(result.body.error.code).toBe('internal');
    expect(result.body.error.message).toBe('Internal server error.');
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain('postgres://');
  });
});

describe('ApiError prototype', () => {
  it('still satisfies instanceof after being thrown and caught', () => {
    let caught: unknown;
    try {
      throw rateLimited(5);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as ApiError).code).toBe('rate_limited');
  });
});
