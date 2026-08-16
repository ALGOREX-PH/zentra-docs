import {
  Account,
  Asset,
  BASE_FEE,
  type Horizon,
  Keypair,
  Operation,
  type Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stellar } from '@/config/stellar';
import { horizon } from '@/lib/stellar/client';
import { SubmitTimeoutError } from '@/lib/stellar/errors';
import { buildPaymentXdr, submitSignedXdr } from '@/lib/stellar/payment';

// The Horizon client is the module boundary: everything below it is the network.
vi.mock('@/lib/stellar/client', () => ({
  horizon: {
    loadAccount: vi.fn(),
    submitTransaction: vi.fn(),
    fetchBaseFee: vi.fn(),
    transactions: vi.fn(),
  },
}));

const SOURCE = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)).publicKey();
const DEST = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 8)).publicKey();

/** A wallet-signed-shaped envelope plus the hash the client computes for it. */
const SIGNED_TX = new TransactionBuilder(new Account(SOURCE, '9'), {
  fee: BASE_FEE,
  networkPassphrase: stellar.networkPassphrase,
})
  .addOperation(Operation.payment({ destination: DEST, asset: Asset.native(), amount: '1' }))
  .setTimeout(0)
  .build();

/**
 * The payment builder's fee memo lives at module scope, so each test starts on
 * a fresh clock hour to step past the previous test's 60s memo window.
 */
let baseTime = Date.parse('2026-01-01T00:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  baseTime += 3_600_000;
  vi.setSystemTime(baseTime);
  vi.mocked(horizon.loadAccount).mockImplementation(() =>
    // A fresh Account per build: the builder mutates its sequence number.
    Promise.resolve(new Account(SOURCE, '42') as unknown as Horizon.AccountResponse),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('buildPaymentXdr', () => {
  it('builds one payment operation with the fetched fee and a bounded timeout', async () => {
    vi.mocked(horizon.fetchBaseFee).mockResolvedValue(200);

    const xdr = await buildPaymentXdr(SOURCE, DEST, '12.5');

    const tx = TransactionBuilder.fromXDR(xdr, stellar.networkPassphrase) as Transaction;
    expect(tx.operations).toHaveLength(1);
    const op = tx.operations[0] as Operation.Payment;
    expect(op.type).toBe('payment');
    expect(op.destination).toBe(DEST);
    expect(op.amount).toBe('12.5000000');
    expect(op.asset.isNative()).toBe(true);
    expect(tx.fee).toBe('200');
    // setTimeout(180): unsigned XDR sitting in a wallet must not stay valid forever.
    expect(Number(tx.timeBounds?.maxTime)).toBe(Math.floor(baseTime / 1000) + 180);
  });

  it('memoises the fetched fee so consecutive builds ask Horizon once', async () => {
    vi.mocked(horizon.fetchBaseFee).mockResolvedValue(200);

    await buildPaymentXdr(SOURCE, DEST, '1');
    const xdr = await buildPaymentXdr(SOURCE, DEST, '2');

    expect(horizon.fetchBaseFee).toHaveBeenCalledTimes(1);
    const tx = TransactionBuilder.fromXDR(xdr, stellar.networkPassphrase) as Transaction;
    expect(tx.fee).toBe('200');
  });

  it('falls back to the protocol minimum when the fee endpoint is unavailable', async () => {
    vi.mocked(horizon.fetchBaseFee).mockRejectedValue(new Error('fee stats down'));

    const xdr = await buildPaymentXdr(SOURCE, DEST, '1');

    const tx = TransactionBuilder.fromXDR(xdr, stellar.networkPassphrase) as Transaction;
    expect(tx.fee).toBe(BASE_FEE);
  });
});

describe('submitSignedXdr', () => {
  const EXPECTED_HASH = SIGNED_TX.hash().toString('hex');

  /** Wire the settlement-poll lookup to `call`. */
  function pollAnswers(call: ReturnType<typeof vi.fn>): ReturnType<typeof vi.fn> {
    const transaction = vi.fn(() => ({ call }));
    vi.mocked(horizon.transactions).mockReturnValue({
      transaction,
    } as unknown as ReturnType<typeof horizon.transactions>);
    return transaction;
  }

  it('maps a clean submission to its hash and ledger', async () => {
    vi.mocked(horizon.submitTransaction).mockResolvedValue({
      hash: EXPECTED_HASH,
      ledger: 7,
    } as unknown as Horizon.HorizonApi.SubmitTransactionResponse);

    await expect(submitSignedXdr(SIGNED_TX.toXDR())).resolves.toEqual({
      hash: EXPECTED_HASH,
      ledger: 7,
    });
  });

  it('rethrows a definite Horizon verdict without any settlement polling', async () => {
    const rejected = {
      response: { status: 400, data: { extras: { result_codes: { transaction: 'tx_bad_seq' } } } },
    };
    vi.mocked(horizon.submitTransaction).mockRejectedValue(rejected);

    await expect(submitSignedXdr(SIGNED_TX.toXDR())).rejects.toBe(rejected);
    expect(horizon.transactions).not.toHaveBeenCalled();
  });

  it('resolves as success when a timed-out submission is later found settled', async () => {
    vi.mocked(horizon.submitTransaction).mockRejectedValue(new Error('Network Error'));
    const call = vi.fn().mockResolvedValue({ successful: true, ledger_attr: 55 });
    const transaction = pollAnswers(call);

    const pending = submitSignedXdr(SIGNED_TX.toXDR());
    await vi.advanceTimersByTimeAsync(5_000);

    // The UI never learns the submission wobbled — same shape as a clean send.
    await expect(pending).resolves.toEqual({ hash: EXPECTED_HASH, ledger: 55 });
    // The ledger was asked about the hash computed client-side before submission.
    expect(transaction).toHaveBeenCalledWith(EXPECTED_HASH);
  });

  it('throws SubmitTimeoutError carrying the hash when the outcome stays unknown', async () => {
    vi.mocked(horizon.submitTransaction).mockRejectedValue(new Error('Network Error'));
    const call = vi.fn().mockRejectedValue({ response: { status: 404 } });
    pollAnswers(call);

    const settled = submitSignedXdr(SIGNED_TX.toXDR()).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(30_000);
    const err = await settled;

    expect(err).toBeInstanceOf(SubmitTimeoutError);
    expect((err as SubmitTimeoutError).hash).toBe(EXPECTED_HASH);
    // Six polls, five seconds apart — the documented settlement window.
    expect(call).toHaveBeenCalledTimes(6);
  });
});
