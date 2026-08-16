import { describe, expect, it } from 'vitest';
import {
  ApiError,
  badRequest,
  isApiError,
  methodNotAllowed,
  notFound,
  payloadTooLarge,
  rateLimited,
  toErrorBody,
  unsupportedMediaType,
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

describe('notFound', () => {
  it('produces a 404 with the not_found code and the given message', () => {
    const err = notFound('No feedback row with that id.');
    expect(err.status).toBe(404);
    expect(err.code).toBe('not_found');
    expect(err.message).toBe('No feedback row with that id.');
  });
});

describe('methodNotAllowed', () => {
  it('produces a 405 with the method_not_allowed code carrying the served methods', () => {
    const err = methodNotAllowed(['GET', 'POST']);
    expect(err.status).toBe(405);
    expect(err.code).toBe('method_not_allowed');
    expect(err.allowedMethods).toEqual(['GET', 'POST']);
  });

  it('surfaces an Allow header from toErrorBody, as RFC 9110 requires of a 405', () => {
    const result = toErrorBody(methodNotAllowed(['GET', 'POST']));
    expect(result.status).toBe(405);
    expect(result.body.error.code).toBe('method_not_allowed');
    expect(result.headers.Allow).toBe('GET, POST');
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

describe('unsupportedMediaType', () => {
  it('produces a 415 with the unsupported_media_type code and names the type wanted', () => {
    const err = unsupportedMediaType('application/json');
    expect(err.status).toBe(415);
    expect(err.code).toBe('unsupported_media_type');
    expect(err.message).toContain('application/json');
  });

  it('survives toErrorBody as the same code and status', () => {
    const result = toErrorBody(unsupportedMediaType('application/json'));
    expect(result.status).toBe(415);
    expect(result.body.error.code).toBe('unsupported_media_type');
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

  it('is true for a branded error from a duplicated copy of the module', () => {
    // What a second bundled copy of errors.ts produces: not our prototype,
    // but the same registry symbol, because Symbol.for is process-wide.
    const foreign = Object.assign(new Error('nope'), {
      status: 429,
      code: 'rate_limited',
      [Symbol.for('zentra.apiError')]: true,
    });

    expect(foreign).not.toBeInstanceOf(ApiError);
    expect(isApiError(foreign)).toBe(true);
  });

  it('is false for an unbranded object merely shaped like an ApiError', () => {
    expect(isApiError({ status: 429, code: 'rate_limited' })).toBe(false);
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
