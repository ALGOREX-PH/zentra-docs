import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  Operation,
  type Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stellar } from '@/config/stellar';
import { ANCHOR_TIMEOUT_MS, verifyAnchor } from '@/lib/api/verify-anchor';

const JSON_HEADERS = { 'content-type': 'application/json' };

/** A well-formed 64-character hex transaction hash. */
const HASH = 'ab'.repeat(32);

/** The wallet doing the claiming, and an unrelated one that is not it. */
const WALLET = `G${'A'.repeat(55)}`;
const OTHER_WALLET = `G${'B'.repeat(55)}`;

/** The contract the badge claims, and an unrelated one that is not it. */
const CONTRACT = Address.contract(Buffer.alloc(32, 1)).toString();
const OTHER_CONTRACT = Address.contract(Buffer.alloc(32, 2)).toString();

/**
 * A checksum-valid source for envelope building. The SDK validates strkeys, so
 * the all-A `WALLET` above cannot sit inside an envelope — and it does not need
 * to: the ownership check reads Horizon's `source_account` field, not the
 * envelope, so the envelope's own source can be any well-formed account.
 */
const SOURCE = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)).publicKey();

/** A v1 transaction whose single operation invokes `contractId`. */
function transactionInvoking(contractId: string): Transaction {
  return new TransactionBuilder(new Account(SOURCE, '1'), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(new Contract(contractId).call('submit'))
    .setTimeout(0)
    .build();
}

/** That invocation as a base64 v1 envelope, the shape Horizon reports. */
const ENVELOPE = transactionInvoking(CONTRACT).toEnvelope().toXDR('base64');
const OTHER_ENVELOPE = transactionInvoking(OTHER_CONTRACT).toEnvelope().toXDR('base64');

/** The same invocation wrapped in a fee-bump envelope, fee paid by another key. */
const FEE_BUMP_ENVELOPE = TransactionBuilder.buildFeeBumpTransaction(
  SOURCE,
  '200',
  transactionInvoking(CONTRACT),
  Networks.TESTNET,
)
  .toEnvelope()
  .toXDR('base64');

/** A real, successful-looking transaction that never touches any contract. */
const PAYMENT_ENVELOPE = new TransactionBuilder(new Account(SOURCE, '1'), {
  fee: BASE_FEE,
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(Operation.payment({ destination: SOURCE, asset: Asset.native(), amount: '1' }))
  .setTimeout(0)
  .build()
  .toEnvelope()
  .toXDR('base64');

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

/** A Horizon transaction record that fully earns the badge; override to break it. */
function anchorTx(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    successful: true,
    source_account: WALLET,
    envelope_xdr: ENVELOPE,
    ...overrides,
  };
}

describe('verifyAnchor', () => {
  it('verifies a successful transaction whose source matches the wallet', async () => {
    fetchMock.mockResolvedValue(horizonOk(anchorTx()));

    const verdict = await verifyAnchor(HASH, WALLET, CONTRACT);

    expect(verdict).toEqual({ verified: true, sourceAccount: WALLET });
  });

  it('skips the account check when the wallet is null', async () => {
    fetchMock.mockResolvedValue(horizonOk(anchorTx({ source_account: OTHER_WALLET })));

    const verdict = await verifyAnchor(HASH, null, CONTRACT);

    // No wallet was claimed, so the source account cannot contradict one; it is
    // still reported so the caller can record who actually anchored it.
    expect(verdict).toEqual({ verified: true, sourceAccount: OTHER_WALLET });
  });

  it('rejects a transaction that belongs to a different account', async () => {
    fetchMock.mockResolvedValue(horizonOk(anchorTx({ source_account: OTHER_WALLET })));

    const verdict = await verifyAnchor(HASH, WALLET, CONTRACT);

    expect(verdict).toEqual({ verified: false, reason: 'wrong_account' });
  });

  it('rejects a transaction that was included but failed', async () => {
    fetchMock.mockResolvedValue(horizonOk(anchorTx({ successful: false })));

    const verdict = await verifyAnchor(HASH, WALLET, CONTRACT);

    expect(verdict).toEqual({ verified: false, reason: 'failed' });
  });

  it('reports a 404 as not_found', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 404, headers: JSON_HEADERS }));

    const verdict = await verifyAnchor(HASH, WALLET, CONTRACT);

    expect(verdict).toEqual({ verified: false, reason: 'not_found' });
  });

  it('reports a 500 as unavailable rather than not_found', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }));

    const verdict = await verifyAnchor(HASH, WALLET, CONTRACT);

    // Horizon being broken is not evidence the hash is fake.
    expect(verdict).toEqual({ verified: false, reason: 'unavailable' });
  });

  it('does not throw when fetch rejects with a network error', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(verifyAnchor(HASH, WALLET, CONTRACT)).resolves.toEqual({
      verified: false,
      reason: 'unavailable',
    });
  });

  it('reports a body that is not JSON as unavailable', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>gateway timeout</html>', { status: 200, headers: JSON_HEADERS }),
    );

    const verdict = await verifyAnchor(HASH, WALLET, CONTRACT);

    expect(verdict).toEqual({ verified: false, reason: 'unavailable' });
  });

  it('reports a 200 with no source_account as unavailable', async () => {
    fetchMock.mockResolvedValue(horizonOk({ successful: true, envelope_xdr: ENVELOPE }));

    const verdict = await verifyAnchor(HASH, WALLET, CONTRACT);

    // A response we do not understand must not be read as a pass.
    expect(verdict).toEqual({ verified: false, reason: 'unavailable' });
  });

  it('requests the transaction from the configured Horizon endpoint', async () => {
    fetchMock.mockResolvedValue(horizonOk(anchorTx()));

    await verifyAnchor(HASH, WALLET, CONTRACT);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toBe(`${stellar.horizonUrl}/transactions/${HASH}`);
    expect(url).toContain(HASH);
    expect(url.startsWith(stellar.horizonUrl)).toBe(true);
  });

  it('passes an abort signal and a JSON accept header', async () => {
    fetchMock.mockResolvedValue(horizonOk(anchorTx()));

    await verifyAnchor(HASH, WALLET, CONTRACT);

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

    const pending = verifyAnchor(HASH, WALLET, CONTRACT);
    await vi.advanceTimersByTimeAsync(ANCHOR_TIMEOUT_MS);

    await expect(pending).resolves.toEqual({ verified: false, reason: 'unavailable' });
  });

  it('leaves no timer pending after a fast response', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(horizonOk(anchorTx()));

    await verifyAnchor(HASH, WALLET, CONTRACT);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves no timer pending after a failed request', async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await verifyAnchor(HASH, WALLET, CONTRACT);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('logs one warn line carrying the hash and the reason when unverified', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 404, headers: JSON_HEADERS }));

    await verifyAnchor(HASH, WALLET, CONTRACT);

    const warn = vi.mocked(console.warn);
    expect(warn).toHaveBeenCalledTimes(1);

    const entry = JSON.parse(String(warn.mock.calls[0][0]));
    expect(entry.level).toBe('warn');
    expect(entry.event).toBe('anchor.unverified');
    expect(entry.reason).toBe('not_found');
    expect(entry.txHash).toBe(HASH);
  });

  it('logs the wrong_account reason rather than a generic failure', async () => {
    fetchMock.mockResolvedValue(horizonOk(anchorTx({ source_account: OTHER_WALLET })));

    await verifyAnchor(HASH, WALLET, CONTRACT);

    const entry = JSON.parse(String(vi.mocked(console.warn).mock.calls[0][0]));
    expect(entry.reason).toBe('wrong_account');
  });

  it('does not log when the transaction verifies', async () => {
    fetchMock.mockResolvedValue(horizonOk(anchorTx()));

    await verifyAnchor(HASH, WALLET, CONTRACT);

    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe('verifyAnchor contract check', () => {
  it('rejects a successful transaction that invoked a different contract', async () => {
    fetchMock.mockResolvedValue(horizonOk(anchorTx({ envelope_xdr: OTHER_ENVELOPE })));

    const verdict = await verifyAnchor(HASH, WALLET, CONTRACT);

    // Real, successful, even sourced from the right wallet — but a call to
    // some other contract anchors nothing here.
    expect(verdict).toEqual({ verified: false, reason: 'wrong_contract' });
  });

  it('rejects a real transaction that never touched any contract', async () => {
    fetchMock.mockResolvedValue(horizonOk(anchorTx({ envelope_xdr: PAYMENT_ENVELOPE })));

    const verdict = await verifyAnchor(HASH, WALLET, CONTRACT);

    // A harvested payment hash is the cheapest fake of all: it exists, it
    // succeeded, and it proves nothing about the feedback contract.
    expect(verdict).toEqual({ verified: false, reason: 'wrong_contract' });
  });

  it('verifies an invocation wrapped in a fee-bump envelope', async () => {
    fetchMock.mockResolvedValue(horizonOk(anchorTx({ envelope_xdr: FEE_BUMP_ENVELOPE })));

    const verdict = await verifyAnchor(HASH, WALLET, CONTRACT);

    // A sponsor paying the fee does not change what the inner transaction did.
    expect(verdict).toEqual({ verified: true, sourceAccount: WALLET });
  });

  it('reports a record with no envelope as unavailable', async () => {
    fetchMock.mockResolvedValue(horizonOk({ successful: true, source_account: WALLET }));

    const verdict = await verifyAnchor(HASH, WALLET, CONTRACT);

    // No envelope means the contract claim cannot be checked at all, and what
    // cannot be checked must not pass.
    expect(verdict).toEqual({ verified: false, reason: 'unavailable' });
  });

  it('reports an undecodable envelope as unavailable rather than a pass', async () => {
    fetchMock.mockResolvedValue(horizonOk(anchorTx({ envelope_xdr: 'not-an-envelope' })));

    const verdict = await verifyAnchor(HASH, WALLET, CONTRACT);

    expect(verdict).toEqual({ verified: false, reason: 'unavailable' });
  });

  it('still enforces ownership before the contract is even considered', async () => {
    fetchMock.mockResolvedValue(
      horizonOk(anchorTx({ source_account: OTHER_WALLET, envelope_xdr: OTHER_ENVELOPE })),
    );

    const verdict = await verifyAnchor(HASH, WALLET, CONTRACT);

    // Both checks fail here; the verdict names the account first, so adding
    // the contract check never weakened or reordered the ownership one.
    expect(verdict).toEqual({ verified: false, reason: 'wrong_account' });
  });

  it('logs the wrong_contract reason rather than a generic failure', async () => {
    fetchMock.mockResolvedValue(horizonOk(anchorTx({ envelope_xdr: OTHER_ENVELOPE })));

    await verifyAnchor(HASH, WALLET, CONTRACT);

    const entry = JSON.parse(String(vi.mocked(console.warn).mock.calls[0][0]));
    expect(entry.reason).toBe('wrong_contract');
  });
});

describe('verifyAnchor input guard', () => {
  it('never reaches the network for a hash that is not 64 hex characters', async () => {
    for (const hash of ['', 'not-a-hash', 'ab'.repeat(31), 'ab'.repeat(33), `${HASH}z`]) {
      const verdict = await verifyAnchor(hash, WALLET, CONTRACT);

      expect(verdict).toEqual({ verified: false, reason: 'not_found' });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a hash that would escape the transactions path', async () => {
    // Pasted into a URL path unchecked, this addresses a different Horizon
    // endpoint whose response would then be read as though it were a
    // transaction.
    const verdict = await verifyAnchor(`../accounts/${WALLET}`, null, CONTRACT);

    expect(verdict).toEqual({ verified: false, reason: 'not_found' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still verifies a well-formed hash', async () => {
    fetchMock.mockResolvedValue(horizonOk(anchorTx()));

    expect(await verifyAnchor(HASH, WALLET, CONTRACT)).toEqual({
      verified: true,
      sourceAccount: WALLET,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('ANCHOR_TIMEOUT_MS', () => {
  it('is a short, positive budget so a slow Horizon cannot stall the route', () => {
    expect(ANCHOR_TIMEOUT_MS).toBe(3000);
  });
});
