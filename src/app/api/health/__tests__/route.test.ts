import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DELETE, GET, PATCH, POST, PUT } from '@/app/api/health/route';
import { activeProfile } from '@/config/network';
import { query } from '@/lib/db';
import { soroban } from '@/lib/stellar/rpc';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
}));

vi.mock('@/lib/stellar/rpc', () => ({
  soroban: { getNetwork: vi.fn() },
}));

const queryMock = query as unknown as ReturnType<typeof vi.fn>;
const getNetworkMock = soroban.getNetwork as unknown as ReturnType<typeof vi.fn>;

/** Make the database probe report the schema fully applied. */
function healthyDatabase(): void {
  queryMock.mockImplementation(() => Promise.resolve([{ feedback: true, users: true }]));
}

/** Make the RPC answer as the chain this build is configured for. */
function healthyChain(): void {
  getNetworkMock.mockResolvedValue({ passphrase: activeProfile.networkPassphrase });
}

function get(): Request {
  return new Request('https://docs.zentra.dev/api/health', {
    headers: { 'x-request-id': 'trace-health' },
  });
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  queryMock.mockReset();
  getNetworkMock.mockReset();
});

describe('GET /api/health', () => {
  it('answers 200 ok while every check passes, never cached', async () => {
    healthyDatabase();
    healthyChain();

    const response = await GET(get());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.requestId).toBe('trace-health');
    expect(body.network).toBe(activeProfile.network);
    expect(body.checks.database.status).toBe('ok');
    expect(body.checks.chain.status).toBe('ok');
    expect(body.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('degrades to 503 with both checks reported when both dependencies fail', async () => {
    queryMock.mockImplementation(() => Promise.reject(new Error('ECONNREFUSED')));
    getNetworkMock.mockRejectedValue(new Error('rpc down'));

    const response = await GET(get());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe('degraded');
    // Every probe answers for itself — one failing must not hide the other.
    expect(body.checks.database).toEqual({ status: 'error', latencyMs: 0, error: 'unavailable' });
    expect(body.checks.chain).toEqual({ status: 'error', latencyMs: 0, error: 'unavailable' });
  });

  it('reports a chain error when the RPC answers with the wrong passphrase', async () => {
    healthyDatabase();
    getNetworkMock.mockResolvedValue({ passphrase: 'Some Other Network ; 2015' });

    const response = await GET(get());
    const body = await response.json();

    // Serving traffic from the wrong chain is not degraded service, it is the
    // wrong service — the RPC answering is no defence.
    expect(response.status).toBe(503);
    expect(body.checks.chain.status).toBe('error');
    expect(body.checks.database.status).toBe('ok');
  });

  it('degrades when the schema is missing even though Postgres answered', async () => {
    queryMock.mockImplementation(() => Promise.resolve([{ feedback: true, users: false }]));
    healthyChain();

    const response = await GET(get());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.checks.database.status).toBe('error');
    expect(body.checks.chain.status).toBe('ok');
  });

  it('tells the caller a fixed generic string and nothing about the failure', async () => {
    queryMock.mockImplementation(() =>
      Promise.reject(new Error('connect failed postgres://user:hunter2@db.neon.tech/app')),
    );
    healthyChain();

    const response = await GET(get());
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(text).not.toContain('postgres');
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('neon');
    expect(JSON.parse(text).checks.database.error).toBe('unavailable');
  });

  it('declares a dependency unhealthy once the probe timeout elapses', async () => {
    vi.useFakeTimers();
    healthyDatabase();
    getNetworkMock.mockImplementation(() => new Promise(() => undefined));

    const pending = GET(get());
    await vi.advanceTimersByTimeAsync(2_000);
    const response = await pending;
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.checks.chain).toEqual({ status: 'error', latencyMs: 0, error: 'unavailable' });
    expect(body.checks.database.status).toBe('ok');
  });
});

describe('unsupported methods on /api/health', () => {
  it('answers POST, PUT, PATCH and DELETE with an enveloped 405 naming GET', async () => {
    for (const handler of [POST, PUT, PATCH, DELETE]) {
      const response = await handler(new Request('https://docs.zentra.dev/api/health'));
      const body = await response.json();

      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('GET');
      expect(body.error.code).toBe('method_not_allowed');
    }
  });
});
