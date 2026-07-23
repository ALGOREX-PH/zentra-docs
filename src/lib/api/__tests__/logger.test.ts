import { afterEach, describe, expect, it, vi } from 'vitest';
import { log, newRequestId, redact } from '@/lib/api/logger';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('redact', () => {
  it('masks values under sensitive keys', () => {
    const out = redact({
      password: 'hunter2',
      apiKey: 'sk-live-123',
      Authorization: 'Bearer abc.def.ghi',
      session_token: 'tok_9',
      DATABASE_URL: 'postgres://user:pw@host/db',
      cookie: 'sid=1',
      connectionString: 'host=db',
      clientSecret: 's3cr3t',
    });

    expect(out.password).toBe('[redacted]');
    expect(out.apiKey).toBe('[redacted]');
    expect(out.Authorization).toBe('[redacted]');
    expect(out.session_token).toBe('[redacted]');
    expect(out.DATABASE_URL).toBe('[redacted]');
    expect(out.cookie).toBe('[redacted]');
    expect(out.connectionString).toBe('[redacted]');
    expect(out.clientSecret).toBe('[redacted]');
  });

  it('leaves ordinary keys untouched', () => {
    const out = redact({ route: '/api/faucet', durationMs: 12, ok: true });

    expect(out.route).toBe('/api/faucet');
    expect(out.durationMs).toBe(12);
    expect(out.ok).toBe(true);
  });

  it('returns a copy, so mutating the result does not affect the input', () => {
    const input = { route: '/api/faucet', password: 'hunter2' };
    const out = redact(input);

    out.route = '/changed';
    out.added = true;

    expect(input.route).toBe('/api/faucet');
    expect('added' in input).toBe(false);
    expect(input.password).toBe('hunter2');
    expect(out).not.toBe(input);
  });
});

describe('log', () => {
  it('writes exactly one JSON line to console.log at info level', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    log('info', 'faucet.requested', { route: '/api/faucet', attempt: 2 });

    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0][0] as string;
    expect(typeof line).toBe('string');
    expect(line).not.toContain('\n');

    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.level).toBe('info');
    expect(parsed.event).toBe('faucet.requested');
    expect(parsed.route).toBe('/api/faucet');
    expect(parsed.attempt).toBe(2);

    const ts = parsed.ts as string;
    expect(Number.isNaN(Date.parse(ts))).toBe(false);
    expect(new Date(ts).toISOString()).toBe(ts);
  });

  it('routes error level to console.error', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    log('error', 'faucet.failed');

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
    expect(JSON.parse(errorSpy.mock.calls[0][0] as string).level).toBe('error');
  });

  it('routes warn level to console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    log('warn', 'faucet.throttled');

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
    expect(JSON.parse(warnSpy.mock.calls[0][0] as string).level).toBe('warn');
  });

  it('pipes fields through redaction before emitting', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    log('info', 'auth.attempt', { password: 'hunter2', user: 'ada' });

    const line = spy.mock.calls[0][0] as string;
    expect(line).not.toContain('hunter2');
    expect(JSON.parse(line).password).toBe('[redacted]');
    expect(JSON.parse(line).user).toBe('ada');
  });

  it('does not throw on a circular field and reports a serialization error', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const circular: Record<string, unknown> = { name: 'loop' };
    circular.self = circular;

    expect(() => log('info', 'circular.event', { payload: circular })).not.toThrow();

    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0][0] as string;
    expect(line).toContain('serializationError');

    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.serializationError).toBe(true);
    expect(parsed.event).toBe('circular.event');
  });
});

describe('newRequestId', () => {
  it('returns a non-empty string', () => {
    const id = newRequestId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('returns a different value on each call', () => {
    expect(newRequestId()).not.toBe(newRequestId());
  });
});
