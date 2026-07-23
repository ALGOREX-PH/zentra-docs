import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_TOKEN_ENV,
  isAdminConfigured,
  requireAdmin,
  timingSafeEqual,
} from '@/lib/api/auth';
import type { ApiError } from '@/lib/api/errors';

/** The configured secret for these tests; distinctive so it is greppable in logs. */
const SECRET = 'zentra-operator-secret-6f3a91c4d0';

/** A credential that is wrong but the same shape, to exercise the 403 path. */
const WRONG = 'zentra-operator-secret-0000000000';

const REQUEST_ID = 'req-auth-test-01';

/** Whatever the environment had before the suite ran, restored after each test. */
const ORIGINAL_TOKEN = process.env[ADMIN_TOKEN_ENV];

/** Every line the logger wrote during a test, captured off the console. */
let emitted: string[] = [];

beforeEach(() => {
  process.env[ADMIN_TOKEN_ENV] = SECRET;
  emitted = [];

  const capture = (...args: unknown[]): void => {
    emitted.push(args.map((arg) => String(arg)).join(' '));
  };
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'warn').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
});

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) {
    delete process.env[ADMIN_TOKEN_ENV];
  } else {
    process.env[ADMIN_TOKEN_ENV] = ORIGINAL_TOKEN;
  }
  vi.restoreAllMocks();
});

/** A request to an operator route carrying exactly `headers`. */
function requestWith(headers: Record<string, string> = {}): Request {
  return new Request('https://example.test/api/admin/export', { headers });
}

/** Run `requireAdmin` expecting a refusal, and hand back the error it threw. */
function denialFrom(request: Request): ApiError {
  try {
    requireAdmin(request, REQUEST_ID);
  } catch (error) {
    return error as ApiError;
  }
  throw new Error('requireAdmin returned a context where it should have thrown.');
}

/** The parsed JSON of every line the logger emitted during the current test. */
function logEntries(): Array<Record<string, unknown>> {
  return emitted.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('requireAdmin with no secret configured', () => {
  it('denies with the not-configured 503 when ADMIN_TOKEN is unset', () => {
    delete process.env[ADMIN_TOKEN_ENV];

    const error = denialFrom(requestWith({ authorization: `Bearer ${SECRET}` }));

    expect(error.status).toBe(503);
    expect(error.code).toBe('upstream_unavailable');
    expect(error.message).toBe('Admin access is not configured.');
  });

  it('denies with the not-configured 503 when ADMIN_TOKEN is an empty string', () => {
    process.env[ADMIN_TOKEN_ENV] = '';

    const error = denialFrom(requestWith({ authorization: `Bearer ${SECRET}` }));

    expect(error.status).toBe(503);
    expect(error.message).toBe('Admin access is not configured.');
  });

  it('denies when ADMIN_TOKEN holds only whitespace', () => {
    process.env[ADMIN_TOKEN_ENV] = '   ';

    // A caller who guessed the blank value must not be let through by matching it.
    expect(denialFrom(requestWith({ authorization: 'Bearer    ' })).status).toBe(503);
    expect(denialFrom(requestWith({ 'x-admin-token': ' ' })).status).toBe(503);
  });

  it('denies with no credential supplied at all', () => {
    delete process.env[ADMIN_TOKEN_ENV];

    const error = denialFrom(requestWith());

    // Configuration is checked first, so this is the 503 and not the 401.
    expect(error.status).toBe(503);
  });

  it('logs the not_configured reason rather than a credential failure', () => {
    delete process.env[ADMIN_TOKEN_ENV];

    denialFrom(requestWith({ authorization: `Bearer ${SECRET}` }));

    const entries = logEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('warn');
    expect(entries[0].event).toBe('admin.denied');
    expect(entries[0].reason).toBe('not_configured');
    expect(entries[0].requestId).toBe(REQUEST_ID);
  });
});

describe('requireAdmin with a valid credential', () => {
  it('accepts an Authorization bearer token', () => {
    const context = requireAdmin(requestWith({ authorization: `Bearer ${SECRET}` }), REQUEST_ID);

    expect(context).toEqual({ authorized: true });
  });

  it('accepts a lowercase bearer scheme', () => {
    const context = requireAdmin(requestWith({ authorization: `bearer ${SECRET}` }), REQUEST_ID);

    expect(context.authorized).toBe(true);
  });

  it('accepts an uppercase BEARER scheme', () => {
    expect(
      requireAdmin(requestWith({ authorization: `BEARER ${SECRET}` }), REQUEST_ID),
    ).toEqual({ authorized: true });
  });

  it('accepts x-admin-token when authorization is absent', () => {
    const context = requireAdmin(requestWith({ 'x-admin-token': SECRET }), REQUEST_ID);

    expect(context).toEqual({ authorized: true });
  });

  it('tolerates surrounding whitespace on either header', () => {
    expect(
      requireAdmin(requestWith({ authorization: `  Bearer   ${SECRET}  ` }), REQUEST_ID).authorized,
    ).toBe(true);
    expect(
      requireAdmin(requestWith({ 'x-admin-token': `  ${SECRET}  ` }), REQUEST_ID).authorized,
    ).toBe(true);
  });

  it('logs one admin.authorized line carrying the request id', () => {
    requireAdmin(requestWith({ authorization: `Bearer ${SECRET}` }), REQUEST_ID);

    const entries = logEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('info');
    expect(entries[0].event).toBe('admin.authorized');
    expect(entries[0].requestId).toBe(REQUEST_ID);
  });
});

describe('requireAdmin with a missing or malformed credential', () => {
  it('refuses a request with neither header as a 401', () => {
    const error = denialFrom(requestWith());

    expect(error.status).toBe(401);
    expect(error.message).toBe('Admin credentials are required.');
  });

  it('refuses an authorization header that is not a bearer scheme as a 401', () => {
    const error = denialFrom(requestWith({ authorization: `Basic ${SECRET}` }));

    expect(error.status).toBe(401);
    expect(error.message).toBe('Admin credentials are required.');
  });

  it('refuses a bearer header with no token after the scheme', () => {
    expect(denialFrom(requestWith({ authorization: 'Bearer' })).status).toBe(401);
    expect(denialFrom(requestWith({ authorization: 'Bearer   ' })).status).toBe(401);
  });

  it('refuses an empty x-admin-token as a 401 rather than matching a blank secret', () => {
    expect(denialFrom(requestWith({ 'x-admin-token': '   ' })).status).toBe(401);
  });

  it('does not fall back to x-admin-token when authorization is present but unusable', () => {
    // The caller declared their credential in `authorization`; honouring a
    // second header would make it ambiguous which one actually authorised.
    const error = denialFrom(
      requestWith({ authorization: `Basic ${SECRET}`, 'x-admin-token': SECRET }),
    );

    expect(error.status).toBe(401);
  });

  it('logs the missing reason', () => {
    denialFrom(requestWith());

    const entries = logEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].event).toBe('admin.denied');
    expect(entries[0].reason).toBe('missing');
  });
});

describe('requireAdmin with a wrong credential', () => {
  it('refuses a wrong bearer token as a 403', () => {
    const error = denialFrom(requestWith({ authorization: `Bearer ${WRONG}` }));

    expect(error.status).toBe(403);
    expect(error.message).toBe('Admin credentials are not valid.');
  });

  it('refuses a wrong x-admin-token as a 403', () => {
    expect(denialFrom(requestWith({ 'x-admin-token': WRONG })).status).toBe(403);
  });

  it('refuses a token that is only a prefix of the secret', () => {
    const error = denialFrom(
      requestWith({ authorization: `Bearer ${SECRET.slice(0, SECRET.length - 1)}` }),
    );

    expect(error.status).toBe(403);
  });

  it('refuses a token that differs only in case', () => {
    expect(
      denialFrom(requestWith({ authorization: `Bearer ${SECRET.toUpperCase()}` })).status,
    ).toBe(403);
  });

  it('logs the invalid reason', () => {
    denialFrom(requestWith({ authorization: `Bearer ${WRONG}` }));

    const entries = logEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].event).toBe('admin.denied');
    expect(entries[0].reason).toBe('invalid');
  });
});

describe('requireAdmin log hygiene', () => {
  it('never writes the expected secret or the supplied token to any line', () => {
    requireAdmin(requestWith({ authorization: `Bearer ${SECRET}` }), REQUEST_ID);
    requireAdmin(requestWith({ 'x-admin-token': SECRET }), REQUEST_ID);
    denialFrom(requestWith({ authorization: `Bearer ${WRONG}` }));
    denialFrom(requestWith({ 'x-admin-token': WRONG }));
    denialFrom(requestWith({ authorization: `Basic ${SECRET}` }));
    denialFrom(requestWith());

    process.env[ADMIN_TOKEN_ENV] = '';
    denialFrom(requestWith({ authorization: `Bearer ${SECRET}` }));

    expect(emitted.length).toBeGreaterThan(0);
    for (const line of emitted) {
      expect(line).not.toContain(SECRET);
      expect(line).not.toContain(WRONG);
    }
  });

  it('does not leak the secret even as a truncated fragment', () => {
    denialFrom(requestWith({ authorization: `Bearer ${SECRET.slice(0, 8)}` }));
    requireAdmin(requestWith({ authorization: `Bearer ${SECRET}` }), REQUEST_ID);

    const joined = emitted.join('\n');
    for (const length of [4, 6, 8, 12]) {
      expect(joined).not.toContain(SECRET.slice(0, length));
    }
  });

  it('emits only the documented fields on a denial', () => {
    denialFrom(requestWith({ authorization: `Bearer ${WRONG}` }));

    const entry = logEntries()[0];
    expect(Object.keys(entry).sort()).toEqual(['event', 'level', 'reason', 'requestId', 'ts']);
  });
});

describe('isAdminConfigured', () => {
  it('is true when a non-empty ADMIN_TOKEN is present', () => {
    expect(isAdminConfigured()).toBe(true);
  });

  it('is false when ADMIN_TOKEN is unset', () => {
    delete process.env[ADMIN_TOKEN_ENV];

    expect(isAdminConfigured()).toBe(false);
  });

  it('is false when ADMIN_TOKEN is empty or whitespace', () => {
    process.env[ADMIN_TOKEN_ENV] = '';
    expect(isAdminConfigured()).toBe(false);

    process.env[ADMIN_TOKEN_ENV] = '  ';
    expect(isAdminConfigured()).toBe(false);
  });

  it('reports without logging anything', () => {
    isAdminConfigured();

    expect(emitted).toEqual([]);
  });
});

describe('timingSafeEqual', () => {
  it('is true for equal strings', () => {
    expect(timingSafeEqual(SECRET, SECRET)).toBe(true);
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
  });

  it('is false for same-length strings that differ', () => {
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'zbc')).toBe(false);
    expect(timingSafeEqual(SECRET, WRONG)).toBe(false);
  });

  it('is false for strings of different lengths', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('abcd', 'abc')).toBe(false);
    expect(timingSafeEqual(SECRET, `${SECRET}x`)).toBe(false);
  });

  it('is true for two empty strings', () => {
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('is false when only one side is empty', () => {
    expect(timingSafeEqual('', 'a')).toBe(false);
    expect(timingSafeEqual('a', '')).toBe(false);
  });

  it('is order-independent', () => {
    expect(timingSafeEqual('alpha', 'alphb')).toBe(timingSafeEqual('alphb', 'alpha'));
    expect(timingSafeEqual('alpha', 'alph')).toBe(timingSafeEqual('alph', 'alpha'));
  });

  it('handles non-ascii characters', () => {
    expect(timingSafeEqual('tökén', 'tökén')).toBe(true);
    expect(timingSafeEqual('tökén', 'token')).toBe(false);
  });

  it('reports a mismatch wherever it falls in the string', () => {
    const base = 'x'.repeat(32);
    for (const position of [0, 1, 15, 31]) {
      const mutated = `${base.slice(0, position)}y${base.slice(position + 1)}`;
      expect(mutated).toHaveLength(base.length);
      expect(timingSafeEqual(base, mutated)).toBe(false);
    }
  });
});
