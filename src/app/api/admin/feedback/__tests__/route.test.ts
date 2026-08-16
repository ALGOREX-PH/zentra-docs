import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DELETE, GET, PATCH, POST, PUT } from '@/app/api/admin/feedback/route';
import { ADMIN_TOKEN_ENV } from '@/lib/api/auth';
import { resetRateLimiter } from '@/lib/api/rate-limit';
import { query } from '@/lib/db';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
}));

const queryMock = query as unknown as ReturnType<typeof vi.fn>;

const TOKEN = 'test-admin-token-77c0de';

let ipCounter = 0;

/** A JSON PATCH carrying `body`, from a fresh address per call. */
function patch(body: unknown, headers: Record<string, string> = {}): Request {
  ipCounter += 1;
  return new Request('https://docs.zentra.dev/api/admin/feedback', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-real-ip': `10.8.${Math.floor(ipCounter / 200)}.${ipCounter % 200}`,
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

describe('PATCH /api/admin/feedback', () => {
  it('flips the hidden flag and reports the row it changed', async () => {
    queryMock.mockImplementation(() => Promise.resolve([{ id: 5 }]));

    const response = await PATCH(patch({ id: 5, hidden: true }, bearer(TOKEN)));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, id: 5, hidden: true });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const call = queryMock.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(call[0].join('$')).toContain('UPDATE feedback');
    // Values in statement order: hidden, id.
    expect(call.slice(1)).toEqual([true, 5]);
  });

  it('unhides with the same operation and a different boolean', async () => {
    queryMock.mockImplementation(() => Promise.resolve([{ id: 7 }]));

    const response = await PATCH(patch({ id: 7, hidden: false }, bearer(TOKEN)));

    expect(await response.json()).toEqual({ ok: true, id: 7, hidden: false });
  });

  it('answers 404 when no row carries that id', async () => {
    queryMock.mockImplementation(() => Promise.resolve([]));

    const response = await PATCH(patch({ id: 999_999, hidden: true }, bearer(TOKEN)));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toEqual({ code: 'not_found', message: 'No feedback row with that id.' });
  });

  it('rejects an id past Number.MAX_SAFE_INTEGER rather than rounding it', async () => {
    // A bigint identity column: anything past 2^53 cannot survive JSON as a
    // number, so acting on it could hide some other row than the one named.
    const response = await PATCH(patch({ id: 2 ** 53, hidden: true }, bearer(TOKEN)));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details.id).toBe('Id must be a positive integer.');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects zero, negative, fractional and string ids', async () => {
    for (const id of [0, -1, 2.5, '5', null]) {
      const response = await PATCH(patch({ id, hidden: true }, bearer(TOKEN)));
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.error.details.id).toBeDefined();
    }
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects the string "false" for hidden rather than hiding the row', async () => {
    const response = await PATCH(patch({ id: 5, hidden: 'false' }, bearer(TOKEN)));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.details.hidden).toBe('Hidden must be a boolean.');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('accumulates both field failures into one 422', async () => {
    const response = await PATCH(patch({ id: '9', hidden: 1 }, bearer(TOKEN)));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(Object.keys(body.error.details).sort()).toEqual(['hidden', 'id']);
  });

  it('rejects a non-object body with a 400', async () => {
    const response = await PATCH(patch([{ id: 5, hidden: true }], bearer(TOKEN)));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('bad_request');
  });

  it('checks the credential before the origin', async () => {
    // An unauthenticated caller must not be able to tell a wrong origin from a
    // wrong token: with no credential the answer is 401 even from a hostile
    // origin, and only an authenticated browser learns the origin was refused.
    const unauthenticated = await PATCH(
      patch({ id: 5, hidden: true }, { origin: 'https://evil.test', host: 'docs.zentra.dev' }),
    );
    expect(unauthenticated.status).toBe(401);

    const authenticated = await PATCH(
      patch(
        { id: 5, hidden: true },
        { ...bearer(TOKEN), origin: 'https://evil.test', host: 'docs.zentra.dev' },
      ),
    );
    const body = await authenticated.json();
    expect(authenticated.status).toBe(403);
    expect(body.error.message).toBe('Cross-origin requests are not accepted on this endpoint.');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('gates 503, 401 and 403 before the body is even read', async () => {
    vi.stubEnv(ADMIN_TOKEN_ENV, '');
    const unconfigured = await PATCH(patch({ id: 5, hidden: true }, bearer(TOKEN)));
    expect(unconfigured.status).toBe(503);

    vi.stubEnv(ADMIN_TOKEN_ENV, TOKEN);
    const missing = await PATCH(patch({ id: 5, hidden: true }));
    expect(missing.status).toBe(401);

    const wrong = await PATCH(patch({ id: 5, hidden: true }, bearer('not-the-token')));
    expect(wrong.status).toBe(403);

    expect(queryMock).not.toHaveBeenCalled();
  });

  it('maps a storage failure to a 503 that leaks nothing', async () => {
    queryMock.mockImplementation(() =>
      Promise.reject(new Error('syntax error at postgres://user:pw@host/db')),
    );

    const response = await PATCH(patch({ id: 5, hidden: true }, bearer(TOKEN)));
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(text).not.toContain('postgres');
    expect(JSON.parse(text).error.message).toBe('Feedback storage is temporarily unavailable.');
  });
});

describe('unsupported methods on /api/admin/feedback', () => {
  it('answers GET, POST, PUT and DELETE with an enveloped 405 naming PATCH', async () => {
    for (const handler of [GET, POST, PUT, DELETE]) {
      const response = await handler(new Request('https://docs.zentra.dev/api/admin/feedback'));
      const body = await response.json();

      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('PATCH');
      expect(body.error.code).toBe('method_not_allowed');
    }
  });
});
