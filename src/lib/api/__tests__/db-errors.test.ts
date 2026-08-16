import { afterEach, describe, expect, it, vi } from 'vitest';

import { isUniqueViolation, storageUnavailable, UNIQUE_VIOLATION } from '@/lib/api/db-errors';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isUniqueViolation', () => {
  it('recognises an error carrying the Postgres 23505 SQLSTATE', () => {
    expect(isUniqueViolation({ code: UNIQUE_VIOLATION })).toBe(true);
  });

  it('rejects other SQLSTATEs, plain errors and non-objects', () => {
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation(new Error('duplicate key'))).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });

  it('compares the code strictly, so the number 23505 does not match', () => {
    expect(isUniqueViolation({ code: 23505 })).toBe(false);
  });
});

describe('storageUnavailable', () => {
  it('returns a 503 carrying only the message the route chose', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const err = storageUnavailable(new Error('boom'), 'feedback.read', 'Storage is unavailable.');

    expect(err.status).toBe(503);
    expect(err.code).toBe('upstream_unavailable');
    expect(err.message).toBe('Storage is unavailable.');
  });

  it('logs the real failure under the given event without leaking it to the client', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const secret = 'connect failed: postgres://user:pw@host/db';

    const err = storageUnavailable(new Error(secret), 'onboard.write', 'Storage is unavailable.');

    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0]?.[0]);
    expect(JSON.parse(line).event).toBe('onboard.write');
    // The logger masks the embedded credential; the client-facing error never
    // carried the driver message at all.
    expect(err.message).not.toContain('postgres://');
    expect(line).not.toContain('user:pw');
  });
});
