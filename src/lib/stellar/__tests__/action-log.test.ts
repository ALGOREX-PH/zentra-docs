import {
  Account,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  nativeToScVal,
  rpc as SorobanRpc,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actionLog } from '@/config/contract';
import {
  getRecent,
  isChainInt,
  isRawEntry,
  pollEvents,
  simulateRead,
  submitInvoke,
} from '@/lib/stellar/action-log';
import { InvokeFailedError, SubmitTimeoutError } from '@/lib/stellar/errors';
import { soroban } from '@/lib/stellar/rpc';

// The RPC client is the module boundary: everything below it is the network.
vi.mock('@/lib/stellar/rpc', () => ({
  soroban: {
    sendTransaction: vi.fn(),
    getTransaction: vi.fn(),
    simulateTransaction: vi.fn(),
    getEvents: vi.fn(),
    getAccount: vi.fn(),
    getLatestLedger: vi.fn(),
  },
}));

const HASH = 'ab'.repeat(32);
const AUTHOR = 'GDUY4FYOA7C5FF45OL5HN2IMVE5CDXO2DZZQNKQXVVDRNCXOSDRHY7LO';
const SOURCE = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)).publicKey();

/** A real envelope for `submitInvoke` to parse — signatures are not checked client-side. */
const SIGNED_XDR = new TransactionBuilder(new Account(SOURCE, '1'), {
  fee: BASE_FEE,
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(new Contract(actionLog.contractId).call('record'))
  .setTimeout(0)
  .build()
  .toXDR();

/** `TransactionResult` fixtures as the RPC parser would hand them over. */
const TX_MALFORMED = xdr.TransactionResult.fromXDR('AAAAAAAAAGT////wAAAAAA==', 'base64');
const TX_FAILED = xdr.TransactionResult.fromXDR('AAAAAAAAAGT/////AAAAAAAAAAA=', 'base64');

/** A diagnostic event whose string payload reads "host fn failed: budget exceeded". */
const BUDGET_DIAGNOSTIC = xdr.DiagnosticEvent.fromXDR(
  'AAAAAAAAAAAAAAAAAAAAAgAAAAAAAAABAAAADwAAAAVlcnJvcgAAAAAAAA4AAAAfaG9zdCBmbiBmYWlsZWQ6IGJ1ZGdldCBleGNlZWRlZAA=',
  'base64',
);

function sent(
  status: SorobanRpc.Api.SendTransactionStatus,
  extra: Partial<SorobanRpc.Api.SendTransactionResponse> = {},
): SorobanRpc.Api.SendTransactionResponse {
  return {
    status,
    hash: HASH,
    latestLedger: 100,
    latestLedgerCloseTime: 0,
    ...extra,
  } as SorobanRpc.Api.SendTransactionResponse;
}

function notFound(): SorobanRpc.Api.GetTransactionResponse {
  return {
    status: SorobanRpc.Api.GetTransactionStatus.NOT_FOUND,
    txHash: HASH,
  } as SorobanRpc.Api.GetTransactionResponse;
}

function succeeded(): SorobanRpc.Api.GetTransactionResponse {
  return {
    status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
    txHash: HASH,
  } as unknown as SorobanRpc.Api.GetTransactionResponse;
}

function failed(): SorobanRpc.Api.GetTransactionResponse {
  return {
    status: SorobanRpc.Api.GetTransactionStatus.FAILED,
    txHash: HASH,
    resultXdr: TX_FAILED,
  } as unknown as SorobanRpc.Api.GetTransactionResponse;
}

/** A successful simulation whose sole payload is `retval`. */
function simSuccess(retval: xdr.ScVal): SorobanRpc.Api.SimulateTransactionResponse {
  return { result: { retval } } as unknown as SorobanRpc.Api.SimulateTransactionResponse;
}

/** One entry encoded exactly as the contract's `Entry`/`Recorded` map decodes. */
function entryScVal(entry: {
  index: bigint;
  author: string;
  message: string;
  ledger: number;
  score: number;
}): xdr.ScVal {
  return nativeToScVal(entry, {
    type: {
      index: ['symbol', 'u64'],
      author: ['symbol', 'string'],
      message: ['symbol', 'string'],
      ledger: ['symbol', 'u32'],
      score: ['symbol', 'u32'],
    },
  });
}

const GOOD_ENTRY = entryScVal({
  index: 1n,
  author: AUTHOR,
  message: 'hello',
  ledger: 123,
  score: 4,
});

const JUNK_VALUE = nativeToScVal('junk', { type: 'string' });

beforeEach(() => {
  vi.clearAllMocks();
  // Skipped-entry batches log one structured warn line; keep the suite output
  // quiet while leaving the spy available to assert against.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('submitInvoke', () => {
  it('throws the decoded result code and diagnostics on an ERROR send, without polling', async () => {
    vi.mocked(soroban.sendTransaction).mockResolvedValue(
      sent('ERROR', { errorResult: TX_MALFORMED, diagnosticEvents: [BUDGET_DIAGNOSTIC] }),
    );

    const err: unknown = await submitInvoke(SIGNED_XDR).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(InvokeFailedError);
    expect((err as InvokeFailedError).message).toContain('txMalformed');
    expect((err as InvokeFailedError).message).toContain('budget exceeded');
    // Refused at the door: never on-chain, so nothing to link.
    expect((err as InvokeFailedError).hash).toBeUndefined();
    expect(soroban.getTransaction).not.toHaveBeenCalled();
  });

  it('throws immediately on TRY_AGAIN_LATER instead of polling for a transaction that was never accepted', async () => {
    vi.mocked(soroban.sendTransaction).mockResolvedValue(sent('TRY_AGAIN_LATER'));

    const err: unknown = await submitInvoke(SIGNED_XDR).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(InvokeFailedError);
    expect((err as InvokeFailedError).message).toMatch(/try again/i);
    expect(soroban.getTransaction).not.toHaveBeenCalled();
  });

  it('throws immediately on DUPLICATE, carrying the hash of the submission already in flight', async () => {
    vi.mocked(soroban.sendTransaction).mockResolvedValue(sent('DUPLICATE'));

    const err: unknown = await submitInvoke(SIGNED_XDR).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(InvokeFailedError);
    expect((err as InvokeFailedError).message).toMatch(/already submitted/i);
    expect((err as InvokeFailedError).hash).toBe(HASH);
    expect(soroban.getTransaction).not.toHaveBeenCalled();
  });

  it('resolves with the hash once a pending transaction is found successful', async () => {
    vi.useFakeTimers();
    vi.mocked(soroban.sendTransaction).mockResolvedValue(sent('PENDING'));
    vi.mocked(soroban.getTransaction)
      .mockResolvedValueOnce(notFound())
      .mockResolvedValue(succeeded());

    const pending = submitInvoke(SIGNED_XDR);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toBe(HASH);
    expect(soroban.getTransaction).toHaveBeenCalledTimes(2);
  });

  it('gives up as unresolved — not failed — when the transaction is never found', async () => {
    vi.useFakeTimers();
    vi.mocked(soroban.sendTransaction).mockResolvedValue(sent('PENDING'));
    vi.mocked(soroban.getTransaction).mockResolvedValue(notFound());

    const settled = submitInvoke(SIGNED_XDR).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(31_000);
    const err = await settled;

    expect(err).toBeInstanceOf(SubmitTimeoutError);
    expect((err as SubmitTimeoutError).hash).toBe(HASH);
    // The initial probe plus one per poll attempt.
    expect(soroban.getTransaction).toHaveBeenCalledTimes(31);
  });

  it('throws the on-chain result code and the hash when the transaction FAILED', async () => {
    vi.mocked(soroban.sendTransaction).mockResolvedValue(sent('PENDING'));
    vi.mocked(soroban.getTransaction).mockResolvedValue(failed());

    const err: unknown = await submitInvoke(SIGNED_XDR).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(InvokeFailedError);
    expect((err as InvokeFailedError).message).toContain('txFailed');
    // Failed transactions are on-chain, so the explorer link must work.
    expect((err as InvokeFailedError).hash).toBe(HASH);
  });
});

describe('simulateRead', () => {
  it('throws the simulation error string when the simulation fails', async () => {
    vi.mocked(soroban.simulateTransaction).mockResolvedValue({
      error: 'sim exploded',
    } as unknown as SorobanRpc.Api.SimulateTransactionResponse);

    await expect(simulateRead(new Contract(actionLog.contractId), 'get_count', [])).rejects.toThrow(
      'sim exploded',
    );
  });

  it('returns null when the simulation succeeds without a return value', async () => {
    vi.mocked(soroban.simulateTransaction).mockResolvedValue(
      {} as unknown as SorobanRpc.Api.SimulateTransactionResponse,
    );

    await expect(
      simulateRead(new Contract(actionLog.contractId), 'get_count', []),
    ).resolves.toBeNull();
  });
});

describe('getRecent', () => {
  it('returns an empty list when the contract answer is not an array', async () => {
    vi.mocked(soroban.simulateTransaction).mockResolvedValue(
      simSuccess(nativeToScVal(5, { type: 'u32' })),
    );

    await expect(getRecent()).resolves.toEqual([]);
  });

  it('decodes valid entries and skips invalid ones with a single structured warn', async () => {
    vi.mocked(soroban.simulateTransaction).mockResolvedValue(
      simSuccess(xdr.ScVal.scvVec([GOOD_ENTRY, JUNK_VALUE])),
    );

    const entries = await getRecent();

    expect(entries).toEqual([
      { index: 1, author: AUTHOR, message: 'hello', ledger: 123, score: 4 },
    ]);
    expect(console.warn).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(vi.mocked(console.warn).mock.calls[0]?.[0])) as Record<
      string,
      unknown
    >;
    expect(line.event).toBe('action_log.entry_skipped');
    expect(line.skipped).toBe(1);
    expect(line.total).toBe(2);
  });
});

describe('pollEvents', () => {
  beforeEach(() => {
    vi.mocked(soroban.getEvents).mockResolvedValue({
      events: [{ value: GOOD_ENTRY }, { value: JUNK_VALUE }],
      latestLedger: 4242,
    } as unknown as SorobanRpc.Api.GetEventsResponse);
  });

  it('requests only recorded events from the action-log contract', async () => {
    await pollEvents(4000);

    const request = vi.mocked(soroban.getEvents).mock.calls[0]?.[0];
    expect(request?.startLedger).toBe(4000);
    expect(request?.filters).toEqual([
      {
        type: 'contract',
        contractIds: [actionLog.contractId],
        topics: [[xdr.ScVal.scvSymbol('recorded').toXDR('base64')]],
      },
    ]);
  });

  it('decodes valid event payloads, skips invalid ones, and reports the latest ledger', async () => {
    const { entries, latestLedger } = await pollEvents(4000);

    expect(entries).toEqual([
      { index: 1, author: AUTHOR, message: 'hello', ledger: 123, score: 4 },
    ]);
    expect(latestLedger).toBe(4242);
    expect(console.warn).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(vi.mocked(console.warn).mock.calls[0]?.[0])) as Record<
      string,
      unknown
    >;
    expect(line.event).toBe('action_log.entry_skipped');
    expect(line.source).toBe('pollEvents');
  });
});

describe('isRawEntry', () => {
  const valid = {
    index: 1n,
    author: AUTHOR,
    message: 'hello',
    ledger: 123,
    score: 4,
  };

  it('accepts an entry with bigint or number integer fields', () => {
    expect(isRawEntry(valid)).toBe(true);
    expect(isRawEntry({ ...valid, index: 1, score: 4n })).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(isRawEntry(null)).toBe(false);
    expect(isRawEntry(undefined)).toBe(false);
    expect(isRawEntry('entry')).toBe(false);
    expect(isRawEntry(42)).toBe(false);
  });

  it('rejects entries missing or mistyping a consumed field', () => {
    expect(isRawEntry({ ...valid, author: undefined })).toBe(false);
    expect(isRawEntry({ ...valid, message: 7 })).toBe(false);
    expect(isRawEntry({ ...valid, ledger: '123' })).toBe(false);
    expect(isRawEntry({ ...valid, score: Number.NaN })).toBe(false);
  });
});

describe('isChainInt', () => {
  it('accepts finite numbers and bigints, rejects everything else', () => {
    expect(isChainInt(0)).toBe(true);
    expect(isChainInt(123n)).toBe(true);
    expect(isChainInt('5')).toBe(false);
    expect(isChainInt(Number.NaN)).toBe(false);
    expect(isChainInt(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isChainInt(null)).toBe(false);
  });
});
