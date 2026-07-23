import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stellar } from '@/config/stellar';
import { ANCHOR_TIMEOUT_MS, verifyAnchor } from '@/lib/api/verify-anchor';

const JSON_HEADERS = { 'content-type': 'application/json' };

/** A well-formed 64-character hex transaction hash. */
const HASH = 'ab'.repeat(32);

/** The wallet doing the claiming, and an unrelated one that is not it. */
const WALLET = `G${'A'.repeat(55)}`;
const OTHER_WALLET = `G${'B'.repeat(55)}`;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  // Every negative verdict logs a warn line; silence it so the suite output
  // stays readable, while keeping the spy available to assert against.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A Horizon-shaped 200 carrying `body` as JSON. */
function horizonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS });
}

describe('verifyAnchor', () => {
  it('verifies a successful transaction whose source matches the wallet', async () => {
    fetchMock.mockResolvedValue(horizonOk({ successful: true, source_account: WALLET }));

    const verdict = await verifyAnchor(HASH, WALLET);

    expect(verdict).toEqual({ verified: true, sourceAccount: WALLET });
  });

  it('skips the account check when the wallet is null', async () => {
    fetchMock.mockResolvedValue(horizonOk({ successful: true, source_account: OTHER_WALLET }));

    const verdict = await verifyAnchor(HASH, null);

    // No wallet was claimed, so the source account cannot contradict one; it is
    // still reported so the caller can record who actually anchored it.
    expect(verdict).toEqual({ verified: true, sourceAccount: OTHER_WALLET });
  });

  it('rejects a transaction that belongs to a different account', async () => {
    fetchMock.mockResolvedValue(horizonOk({ successful: true, source_account: OTHER_WALLET }));

    const verdict = await verifyAnchor(HASH, WALLET);

    expect(verdict).toEqual({ verified: false, reason: 'wrong_account' });
  });

  it('rejects a transaction that was included but failed', async () => {
    fetchMock.mockResolvedValue(horizonOk({ successful: false, source_account: WALLET }));

    const verdict = await verifyAnchor(HASH, WALLET);

    expect(verdict).toEqual({ verified: false, reason: 'failed' });
  });

  it('reports a 404 as not_found', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 404, headers: JSON_HEADERS }));

    const verdict = await verifyAnchor(HASH, WALLET);

    expect(verdict).toEqual({ verified: false, reason: 'not_found' });
  });

  it('reports a 500 as unavailable rather than not_found', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }));

    const verdict = await verifyAnchor(HASH, WALLET);

    // Horizon being broken is not evidence the hash is fake.
    expect(verdict).toEqual({ verified: false, reason: 'unavailable' });
  });

  it('does not throw when fetch rejects with a network error', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(verifyAnchor(HASH, WALLET)).resolves.toEqual({
      verified: false,
      reason: 'unavailable',
    });
  });

  it('reports a body that is not JSON as unavailable', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>gateway timeout</html>', { status: 200, headers: JSON_HEADERS }),
    );

    const verdict = await verifyAnchor(HASH, WALLET);

    expect(verdict).toEqual({ verified: false, reason: 'unavailable' });
  });

  it('reports a 200 with no source_account as unavailable', async () => {
    fetchMock.mockResolvedValue(horizonOk({ successful: true }));

    const verdict = await verifyAnchor(HASH, WALLET);

    // A response we do not understand must not be read as a pass.
    expect(verdict).toEqual({ verified: false, reason: 'unavailable' });
  });

  it('requests the transaction from the configured Horizon endpoint', async () => {
    fetchMock.mockResolvedValue(horizonOk({ successful: true, source_account: WALLET }));

    await verifyAnchor(HASH, WALLET);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toBe(`${stellar.horizonUrl}/transactions/${HASH}`);
    expect(url).toContain(HASH);
    expect(url.startsWith(stellar.horizonUrl)).toBe(true);
  });

  it('passes an abort signal and a JSON accept header', async () => {
    fetchMock.mockResolvedValue(horizonOk({ successful: true, source_account: WALLET }));

    await verifyAnchor(HASH, WALLET);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal?.aborted).toBe(false);
    expect(init.headers).toEqual({ accept: 'application/json' });
  });

  it('aborts and reports unavailable once the timeout elapses', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );

    const pending = verifyAnchor(HASH, WALLET);
    await vi.advanceTimersByTimeAsync(ANCHOR_TIMEOUT_MS);

    await expect(pending).resolves.toEqual({ verified: false, reason: 'unavailable' });
  });

  it('leaves no timer pending after a fast response', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(horizonOk({ successful: true, source_account: WALLET }));

    await verifyAnchor(HASH, WALLET);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves no timer pending after a failed request', async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await verifyAnchor(HASH, WALLET);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('logs one warn line carrying the hash and the reason when unverified', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 404, headers: JSON_HEADERS }));

    await verifyAnchor(HASH, WALLET);

    const warn = vi.mocked(console.warn);
    expect(warn).toHaveBeenCalledTimes(1);

    const entry = JSON.parse(String(warn.mock.calls[0][0]));
    expect(entry.level).toBe('warn');
    expect(entry.event).toBe('anchor.unverified');
    expect(entry.reason).toBe('not_found');
    expect(entry.txHash).toBe(HASH);
  });

  it('logs the wrong_account reason rather than a generic failure', async () => {
    fetchMock.mockResolvedValue(horizonOk({ successful: true, source_account: OTHER_WALLET }));

    await verifyAnchor(HASH, WALLET);

    const entry = JSON.parse(String(vi.mocked(console.warn).mock.calls[0][0]));
    expect(entry.reason).toBe('wrong_account');
  });

  it('does not log when the transaction verifies', async () => {
    fetchMock.mockResolvedValue(horizonOk({ successful: true, source_account: WALLET }));

    await verifyAnchor(HASH, WALLET);

    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe('ANCHOR_TIMEOUT_MS', () => {
  it('is a short, positive budget so a slow Horizon cannot stall the route', () => {
    expect(ANCHOR_TIMEOUT_MS).toBe(3000);
  });
});
