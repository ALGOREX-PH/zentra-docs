import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DELETE, GET, PATCH, POST, PUT } from '@/app/api/onboard/route';
import { resetRateLimiter } from '@/lib/api/rate-limit';
import { READ_CACHE_CONTROL } from '@/lib/api/route';
import { query, sql } from '@/lib/db';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  sql: vi.fn(),
}));

const queryMock = query as unknown as ReturnType<typeof vi.fn>;
const sqlMock = sql as unknown as ReturnType<typeof vi.fn>;

const WALLET = `G${'B'.repeat(55)}`;

/** One statement the handler issued through the mocked seam. */
interface Captured {
  text: string;
  values: unknown[];
}

/** Route every `sql()` tagged call into `captured`, resolving with no rows. */
function captureInserts(): Captured[] {
  const captured: Captured[] = [];
  sqlMock.mockReturnValue((strings: TemplateStringsArray, ...values: unknown[]) => {
    captured.push({ text: strings.join('$'), values });
    return Promise.resolve([]);
  });
  return captured;
}

/** Make every `sql()` tagged call reject with `error`. */
function failInsert(error: unknown): void {
  sqlMock.mockReturnValue(() => Promise.reject(error));
}

let ipCounter = 0;

/** A JSON POST from a fresh address, so tests never share a rate bucket. */
function post(body: unknown, headers: Record<string, string> = {}): Request {
  ipCounter += 1;
  return new Request('https://docs.zentra.dev/api/onboard', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-real-ip': `10.3.${Math.floor(ipCounter / 200)}.${ipCounter % 200}`,
      ...headers,
    },
  });
}

function get(): Request {
  ipCounter += 1;
  return new Request('https://docs.zentra.dev/api/onboard', {
    headers: { 'x-real-ip': `10.4.${Math.floor(ipCounter / 200)}.${ipCounter % 200}` },
  });
}

/** A signup body every field of which is valid; override to break one. */
function signup(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Ada Lovelace',
    email: 'Ada@Example.COM',
    wallet: WALLET,
    rating: 5,
    ...overrides,
  };
}

beforeEach(() => {
  resetRateLimiter();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  queryMock.mockReset();
  sqlMock.mockReset();
});

describe('POST /api/onboard', () => {
  it('stores a valid signup lowercased and answers 201 with rate-limit headers', async () => {
    const inserts = captureInserts();

    const response = await POST(post(signup({ note: '  keen to  test ' })));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('X-RateLimit-Limit')).toBe('3');
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('2');

    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.text).toContain('INSERT INTO users');
    // Values in statement order: name, email, wallet, rating, note. The email
    // lands trimmed and lowercased — the lower(email) unique index assumes it.
    expect(inserts[0]?.values).toEqual([
      'Ada Lovelace',
      'ada@example.com',
      WALLET,
      5,
      'keen to test',
    ]);
  });

  it('logs the signup without the name or the email ever appearing', async () => {
    captureInserts();
    const log = vi.mocked(console.log);

    await POST(post(signup()));

    // Two info lines: onboard.created and the wrapper's request line. The log
    // drain is third-party, so neither may carry the person's identity.
    const lines = log.mock.calls.map((call) => String(call[0]));
    const joined = lines.join('\n');
    expect(joined).toContain('onboard.created');
    expect(joined).toContain(WALLET);
    expect(joined.toLowerCase()).not.toContain('ada');
    expect(joined.toLowerCase()).not.toContain('example.com');
    expect(joined).not.toContain('Lovelace');
  });

  it('maps a duplicate email or wallet to one 409 that names neither', async () => {
    failInsert({ code: '23505' });

    const response = await POST(post(signup()));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: { code: 'conflict', message: 'This email or wallet is already registered.' },
    });
    // Which of the two collided is deliberately not reported: confirming a
    // given address is registered would turn this into a lookup oracle.
    expect(JSON.stringify(body)).not.toMatch(/already registered email|already registered wallet/);
  });

  it('answers 422 with every field failure when the body is invalid', async () => {
    const inserts = captureInserts();

    const response = await POST(post({ name: '  ', email: 'nope', wallet: 'GABC' }));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe('validation_failed');
    expect(Object.keys(body.error.details).sort()).toEqual(['email', 'name', 'wallet']);
    expect(inserts).toHaveLength(0);
  });

  it('maps a storage failure to a 503 that leaks nothing', async () => {
    failInsert(new Error('connect ECONNREFUSED postgres://user:pw@host/db'));

    const response = await POST(post(signup()));
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(text).not.toContain('postgres');
    expect(JSON.parse(text).error.message).toBe('Signup storage is temporarily unavailable.');
  });

  it('answers the request past the tight write limit with a 429', async () => {
    captureInserts();
    const headers = { 'x-real-ip': '10.8.8.8' };
    for (let i = 0; i < 3; i += 1) {
      const response = await POST(post(signup({ email: `a${i}@example.com` }), headers));
      expect(response.status).toBe(201);
    }

    const blocked = await POST(post(signup(), headers));
    const body = await blocked.json();

    expect(blocked.status).toBe(429);
    expect(body.error.code).toBe('rate_limited');
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
  });

  it('refuses a cross-origin signup before touching storage', async () => {
    const inserts = captureInserts();

    const response = await POST(
      post(signup(), { origin: 'https://evil.test', host: 'docs.zentra.dev' }),
    );

    expect(response.status).toBe(403);
    expect(inserts).toHaveLength(0);
  });
});

describe('GET /api/onboard', () => {
  it('returns only the count, cached under the shared read policy', async () => {
    queryMock.mockImplementation(() => Promise.resolve([{ count: 42 }]));

    const response = await GET(get());
    const body = await response.json();

    expect(response.status).toBe(200);
    // Deliberately bare: everything else in the table is personal data and
    // this response is public and cached at the edge.
    expect(body).toEqual({ count: 42 });
    expect(response.headers.get('cache-control')).toBe(READ_CACHE_CONTROL);
    expect(response.headers.get('X-RateLimit-Limit')).toBeNull();
  });

  it('defaults to zero when the table answers no row', async () => {
    queryMock.mockImplementation(() => Promise.resolve([]));

    const response = await GET(get());

    expect(await response.json()).toEqual({ count: 0 });
  });

  it('maps a read failure to a 503 with the route message only', async () => {
    queryMock.mockImplementation(() => Promise.reject(new Error('no pg_hba.conf entry')));

    const response = await GET(get());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.message).toBe('Signup storage is temporarily unavailable.');
  });
});

describe('unsupported methods on /api/onboard', () => {
  it('answers PUT, PATCH and DELETE with an enveloped 405 naming GET and POST', async () => {
    for (const handler of [PUT, PATCH, DELETE]) {
      const response = await handler(new Request('https://docs.zentra.dev/api/onboard'));
      const body = await response.json();

      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('GET, POST');
      expect(body.error.code).toBe('method_not_allowed');
    }
  });
});
