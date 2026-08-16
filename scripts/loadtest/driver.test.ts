/**
 * Driver tests. No network: the RPC seam is injected, so the real work — XDR
 * assembly, real ed25519 signing, stage attribution, deadline handling and
 * redaction — runs against stubbed responses.
 *
 * The fixtures are hand-built rather than recorded. Only the fields the driver
 * reads are populated; fabricating full envelope/result/meta XDR would test the
 * SDK's decoders instead of the classification logic these tests exist for.
 */

import {
  Account,
  Address,
  Keypair,
  Networks,
  nativeToScVal,
  SorobanDataBuilder,
  rpc as SorobanRpc,
  type Transaction,
  xdr,
} from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
  countDistinctAuthorsLowerBound,
  type LoadTestRpc,
  MAX_MESSAGE_BYTES,
  RECENT_WINDOW,
  readActionLogCount,
  recordOnce,
} from './driver';
import type { FundedAccount, LoadTestConfig } from './types';

/**
 * Real testnet strkeys, used as fixtures only — nothing here contacts a network.
 * Valid ids matter because `new Contract(id)` and `Address.fromString` decode
 * them for real, so a fake id would fail for the wrong reason.
 */
const ACTION_LOG_ID = 'CCSXFTQTWVSHUMH2C64RJKY7JKCVHD5REFIW3P3YPVY6PWHVSJ7ZDDES';
const REPUTATION_ID = 'CA2QOMGVQ5XWGFDYT5XEJ7EQ6B6H4ZNDAPS337P3BT55XY3DJY4AIIPI';
const READ_SOURCE = 'GDUY4FYOA7C5FF45OL5HN2IMVE5CDXO2DZZQNKQXVVDRNCXOSDRHY7LO';
const TX_HASH = 'a2f0b7c1d3e4956871a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708';

function makeConfig(overrides: Partial<LoadTestConfig> = {}): LoadTestConfig {
  return {
    accounts: 1,
    concurrency: 1,
    rpcUrl: 'https://rpc.invalid/soroban',
    networkPassphrase: Networks.TESTNET,
    friendbotUrl: 'https://friendbot.invalid',
    actionLogId: ACTION_LOG_ID,
    reputationId: REPUTATION_ID,
    message: 'load test entry',
    timeoutMs: 5_000,
    ...overrides,
  };
}

function makeAccount(overrides: Partial<FundedAccount> = {}): FundedAccount {
  const keypair = Keypair.random();
  return {
    publicKey: keypair.publicKey(),
    secret: keypair.secret(),
    fundedAtLedger: 1_000,
    fundingMs: 900,
    ...overrides,
  };
}

/** A successful simulation carrying just enough for `assembleTransaction`. */
function simSuccess(): SorobanRpc.Api.SimulateTransactionResponse {
  return {
    _parsed: true,
    id: '1',
    latestLedger: 1_000,
    events: [],
    minResourceFee: '54321',
    transactionData: new SorobanDataBuilder(),
    // `record` returns the new entry index; assembly reads `auth`, which is
    // empty here because source-account auth covers `require_auth`.
    result: { auth: [], retval: nativeToScVal(0, { type: 'u64' }) },
  };
}

function simError(error: string): SorobanRpc.Api.SimulateTransactionResponse {
  return { _parsed: true, id: '1', latestLedger: 1_000, events: [], error };
}

function simReturning(retval: xdr.ScVal): SorobanRpc.Api.SimulateTransactionResponse {
  return { ...simSuccess(), result: { auth: [], retval } };
}

function sendResult(
  status: SorobanRpc.Api.SendTransactionStatus,
): SorobanRpc.Api.SendTransactionResponse {
  return { status, hash: TX_HASH, latestLedger: 1_000, latestLedgerCloseTime: 1_700_000_000 };
}

function txStatus(
  status: SorobanRpc.Api.GetTransactionStatus,
  ledger?: number,
): SorobanRpc.Api.GetTransactionResponse {
  return {
    status,
    txHash: TX_HASH,
    latestLedger: 1_010,
    latestLedgerCloseTime: 1_700_000_005,
    oldestLedger: 1,
    oldestLedgerCloseTime: 1_699_000_000,
    ledger,
    createdAt: 1_700_000_005,
    applicationOrder: 1,
    feeBump: false,
  } as unknown as SorobanRpc.Api.GetTransactionResponse;
}

/** Happy-path RPC; each test overrides only the call it is interested in. */
function stubRpc(overrides: Partial<LoadTestRpc> = {}): LoadTestRpc {
  return {
    getAccount: async (address) => new Account(address, '42'),
    simulateTransaction: async () => simSuccess(),
    sendTransaction: async () => sendResult('PENDING'),
    getTransaction: async () => txStatus(SorobanRpc.Api.GetTransactionStatus.SUCCESS, 1_009),
    ...overrides,
  };
}

/** An `Entry` as `get_recent` returns it: an ScMap with symbol keys. */
function recentEntry(author: string | null, index: number): xdr.ScVal {
  const fields: Record<string, unknown> = {
    index,
    ledger: 1_000 + index,
    message: 'load test entry',
    score: 1,
  };
  if (author !== null) {
    fields.author = Address.fromString(author);
  }
  return nativeToScVal(fields, {
    type: {
      author: ['symbol', null],
      index: ['symbol', 'u64'],
      ledger: ['symbol', 'u32'],
      message: ['symbol', 'string'],
      score: ['symbol', 'u32'],
    },
  });
}

describe('recordOnce', () => {
  it('returns the real hash and ledger on a confirmed record', async () => {
    const account = makeAccount();
    const attempt = await recordOnce(account, makeConfig(), stubRpc());

    expect(attempt.ok).toBe(true);
    expect(attempt.publicKey).toBe(account.publicKey);
    expect(attempt.txHash).toBe(TX_HASH);
    expect(attempt.ledger).toBe(1_009);
    expect(attempt.failure).toBeNull();
    expect(attempt.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('submits a transaction sourced at the author and signed once', async () => {
    const account = makeAccount();
    const submitted: Transaction[] = [];
    const client = stubRpc({
      sendTransaction: async (tx) => {
        submitted.push(tx);
        return sendResult('PENDING');
      },
    });

    await recordOnce(account, makeConfig(), client);

    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.source).toBe(account.publicKey);
    // One signature, from the author: source-account auth is what satisfies
    // `author.require_auth()`, so a second entry would mean the driver had
    // started signing authorisation entries it has no business signing.
    expect(submitted[0]?.signatures).toHaveLength(1);
  });

  it('treats DUPLICATE as already in flight and polls it to success', async () => {
    const attempt = await recordOnce(
      makeAccount(),
      makeConfig(),
      stubRpc({ sendTransaction: async () => sendResult('DUPLICATE') }),
    );

    expect(attempt.ok).toBe(true);
    expect(attempt.txHash).toBe(TX_HASH);
  });

  it('tags a simulation failure as build', async () => {
    const attempt = await recordOnce(
      makeAccount(),
      makeConfig(),
      stubRpc({
        simulateTransaction: async () => simError('HostError: Error(Contract, #2) MessageTooLong'),
      }),
    );

    expect(attempt.ok).toBe(false);
    expect(attempt.failure?.stage).toBe('build');
    expect(attempt.failure?.message).toContain('#2');
    expect(attempt.txHash).toBeNull();
    expect(attempt.ledger).toBeNull();
  });

  it('tags an unloadable source account as build', async () => {
    const attempt = await recordOnce(
      makeAccount(),
      makeConfig(),
      stubRpc({
        getAccount: async () => {
          throw new Error('Account not found: 404');
        },
      }),
    );

    expect(attempt.failure?.stage).toBe('build');
    expect(attempt.failure?.message).toMatch(/not found/i);
  });

  it('tags a restore preamble as build rather than submitting a doomed invoke', async () => {
    const attempt = await recordOnce(
      makeAccount(),
      makeConfig(),
      stubRpc({
        simulateTransaction: async () => ({
          ...simSuccess(),
          result: { auth: [], retval: nativeToScVal(0, { type: 'u64' }) },
          restorePreamble: {
            minResourceFee: '1000',
            transactionData: new SorobanDataBuilder(),
          },
        }),
      }),
    );

    expect(attempt.failure?.stage).toBe('build');
    expect(attempt.failure?.message).toMatch(/restor/i);
  });

  it('rejects an over-long message before spending an RPC call', async () => {
    let calls = 0;
    const count = () => {
      calls += 1;
    };
    const client = stubRpc({
      getAccount: async (address) => {
        count();
        return new Account(address, '42');
      },
      simulateTransaction: async () => {
        count();
        return simSuccess();
      },
    });

    const attempt = await recordOnce(
      makeAccount(),
      makeConfig({ message: 'x'.repeat(MAX_MESSAGE_BYTES + 1) }),
      client,
    );

    expect(attempt.failure?.stage).toBe('build');
    expect(attempt.failure?.message).toContain(String(MAX_MESSAGE_BYTES));
    expect(calls).toBe(0);
  });

  it('counts message length in bytes, so a multi-byte body under the character limit is rejected', async () => {
    // 60 four-byte characters is 240 bytes: comfortably under 200 *characters*,
    // and over the contract's 200-byte bound.
    const attempt = await recordOnce(
      makeAccount(),
      makeConfig({ message: '𝄞'.repeat(60) }),
      stubRpc(),
    );

    expect(attempt.failure?.stage).toBe('build');
    expect(attempt.failure?.message).toContain('240 bytes');
  });

  it('tags a malformed secret as sign', async () => {
    const account = makeAccount({ secret: 'not-a-real-secret-seed' });
    const attempt = await recordOnce(account, makeConfig(), stubRpc());

    expect(attempt.failure?.stage).toBe('sign');
    expect(attempt.failure?.message).not.toContain('not-a-real-secret-seed');
  });

  it('tags a submission rejection as submit and reports no hash', async () => {
    const attempt = await recordOnce(
      makeAccount(),
      makeConfig(),
      stubRpc({ sendTransaction: async () => sendResult('ERROR') }),
    );

    expect(attempt.ok).toBe(false);
    expect(attempt.failure?.stage).toBe('submit');
    expect(attempt.failure?.message).toContain('ERROR');
    // Never synthesised: a hash the network refused resolves on no explorer.
    expect(attempt.txHash).toBeNull();
    expect(attempt.ledger).toBeNull();
  });

  it('tags backpressure at submission as submit', async () => {
    const attempt = await recordOnce(
      makeAccount(),
      makeConfig(),
      stubRpc({ sendTransaction: async () => sendResult('TRY_AGAIN_LATER') }),
    );

    expect(attempt.failure?.stage).toBe('submit');
    expect(attempt.failure?.message).toContain('TRY_AGAIN_LATER');
  });

  it('tags a thrown submission as submit', async () => {
    const attempt = await recordOnce(
      makeAccount(),
      makeConfig(),
      stubRpc({
        sendTransaction: async () => {
          throw new Error('502 Bad Gateway');
        },
      }),
    );

    expect(attempt.failure?.stage).toBe('submit');
    expect(attempt.failure?.message).toContain('502');
  });

  it('tags an accepted-but-failed transaction as confirm, keeping its hash and ledger', async () => {
    const attempt = await recordOnce(
      makeAccount(),
      makeConfig(),
      stubRpc({
        getTransaction: async () => txStatus(SorobanRpc.Api.GetTransactionStatus.FAILED, 1_011),
      }),
    );

    expect(attempt.ok).toBe(false);
    expect(attempt.failure?.stage).toBe('confirm');
    expect(attempt.failure?.message).toMatch(/applied but failed/);
    // Both are real and both are diagnostic: the transaction did land.
    expect(attempt.txHash).toBe(TX_HASH);
    expect(attempt.ledger).toBe(1_011);
  });

  it('tags a transaction that never confirms as confirm, with no ledger', async () => {
    const attempt = await recordOnce(
      makeAccount(),
      makeConfig({ timeoutMs: 40 }),
      stubRpc({
        getTransaction: async () => txStatus(SorobanRpc.Api.GetTransactionStatus.NOT_FOUND),
      }),
    );

    expect(attempt.failure?.stage).toBe('confirm');
    expect(attempt.failure?.message).toMatch(/timed out/);
    expect(attempt.txHash).toBe(TX_HASH);
    expect(attempt.ledger).toBeNull();
  });

  it('abandons a stuck submission once the per-attempt deadline passes', async () => {
    const attempt = await recordOnce(
      makeAccount(),
      makeConfig({ timeoutMs: 40 }),
      stubRpc({
        // Never settles — the case the deadline exists for.
        sendTransaction: () => new Promise<SorobanRpc.Api.SendTransactionResponse>(() => {}),
      }),
    );

    expect(attempt.ok).toBe(false);
    expect(attempt.failure?.stage).toBe('submit');
    expect(attempt.failure?.message).toMatch(/timed out after 40ms/);
    expect(attempt.txHash).toBeNull();
  });

  it('honours a run-level abort without filing it as a timeout', async () => {
    const run = new AbortController();
    const attempt = recordOnce(
      makeAccount(),
      // A deadline far too long to be what ends this attempt.
      makeConfig({ timeoutMs: 60_000 }),
      stubRpc({
        sendTransaction: () => new Promise<SorobanRpc.Api.SendTransactionResponse>(() => {}),
      }),
      run.signal,
    );
    // Let the attempt reach the stuck submission before pulling the plug.
    await new Promise((resolve) => setTimeout(resolve, 0));
    run.abort();

    const result = await attempt;
    expect(result.failure?.stage).toBe('submit');
    // An operator interrupt is not evidence of a slow network.
    expect(result.failure?.message).toBe('aborted before completion');
  });

  it('records latency on a failing attempt', async () => {
    const attempt = await recordOnce(
      makeAccount(),
      makeConfig(),
      stubRpc({
        simulateTransaction: async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return simError('resource limit exceeded');
        },
      }),
    );

    expect(attempt.ok).toBe(false);
    // A slow failure is a finding, so it must not be reported as free.
    expect(attempt.latencyMs).toBeGreaterThanOrEqual(20);
  });

  it('never lets the account secret reach a returned message', async () => {
    const account = makeAccount();
    const attempt = await recordOnce(
      makeAccount({ secret: account.secret, publicKey: account.publicKey }),
      makeConfig(),
      stubRpc({
        getAccount: async () => {
          // The shape of the risk: a layer quoting its own input back.
          throw new Error(`bad request for ${account.secret} on GDUMMY`);
        },
      }),
    );

    expect(attempt.failure?.message).not.toContain(account.secret);
    expect(attempt.failure?.message).toContain('[redacted]');
    // Nothing else on the attempt carries it either — this whole object is
    // serialised into the report.
    expect(JSON.stringify(attempt)).not.toContain(account.secret);
  });

  it('redacts a seed it was never given', async () => {
    const strayer = Keypair.random().secret();
    const attempt = await recordOnce(
      makeAccount(),
      makeConfig(),
      stubRpc({
        simulateTransaction: async () => simError(`could not parse seed ${strayer}`),
      }),
    );

    expect(attempt.failure?.message).not.toContain(strayer);
    expect(attempt.failure?.message).toContain('[redacted]');
  });

  it('flattens and truncates a sprawling error into one report-safe line', async () => {
    const attempt = await recordOnce(
      makeAccount(),
      makeConfig(),
      stubRpc({
        simulateTransaction: async () => simError(`diagnostics:\n${'e'.repeat(900)}`),
      }),
    );

    const message = attempt.failure?.message ?? '';
    expect(message).not.toContain('\n');
    expect(message.length).toBeLessThanOrEqual(301);
  });
});

describe('readActionLogCount', () => {
  it('decodes the u64 count to a JSON-safe number', async () => {
    const count = await readActionLogCount(
      makeConfig(),
      READ_SOURCE,
      stubRpc({
        simulateTransaction: async () => simReturning(nativeToScVal(1_234, { type: 'u64' })),
      }),
    );

    expect(count).toBe(1_234);
    // A bigint would make the report unserialisable.
    expect(typeof count).toBe('number');
    expect(() => JSON.stringify({ count })).not.toThrow();
  });

  it('reads zero when the log has no entries yet', async () => {
    const count = await readActionLogCount(
      makeConfig(),
      READ_SOURCE,
      stubRpc({ simulateTransaction: async () => simReturning(xdr.ScVal.scvVoid()) }),
    );

    expect(count).toBe(0);
  });

  it('rejects when the read simulation fails, so the report can record null', async () => {
    await expect(
      readActionLogCount(
        makeConfig(),
        READ_SOURCE,
        stubRpc({ simulateTransaction: async () => simError('no such contract') }),
      ),
    ).rejects.toThrow(/get_count/);
  });

  it('gives up on a stalled read rather than holding the report open', async () => {
    await expect(
      readActionLogCount(
        makeConfig({ timeoutMs: 40 }),
        READ_SOURCE,
        stubRpc({
          simulateTransaction: () =>
            new Promise<SorobanRpc.Api.SimulateTransactionResponse>(() => {}),
        }),
      ),
    ).rejects.toThrow(/timed out after 40ms/);
  });
});

describe('countDistinctAuthorsLowerBound', () => {
  it('counts each author once across the recent window', async () => {
    const repeat = Keypair.random().publicKey();
    const other = Keypair.random().publicKey();
    const value = await countDistinctAuthorsLowerBound(
      makeConfig(),
      READ_SOURCE,
      stubRpc({
        simulateTransaction: async () =>
          simReturning(
            xdr.ScVal.scvVec([
              recentEntry(repeat, 2),
              recentEntry(other, 1),
              recentEntry(repeat, 0),
            ]),
          ),
      }),
    );

    expect(value).toBe(2);
  });

  it('stays a lower bound when the run outgrew the contract cap', async () => {
    const accountsThatRecorded = 25;
    // What the contract actually returns for such a run: the newest 20 entries,
    // each from a different account.
    const visible = Array.from({ length: RECENT_WINDOW }, (_, i) =>
      recentEntry(Keypair.random().publicKey(), i),
    );

    const value = await countDistinctAuthorsLowerBound(
      makeConfig({ accounts: accountsThatRecorded }),
      READ_SOURCE,
      stubRpc({ simulateTransaction: async () => simReturning(xdr.ScVal.scvVec(visible)) }),
    );

    expect(value).toBe(RECENT_WINDOW);
    expect(value).toBeLessThan(accountsThatRecorded);
  });

  it('skips an entry that decoded without an author instead of counting it', async () => {
    const author = Keypair.random().publicKey();
    const value = await countDistinctAuthorsLowerBound(
      makeConfig(),
      READ_SOURCE,
      stubRpc({
        simulateTransaction: async () =>
          simReturning(xdr.ScVal.scvVec([recentEntry(author, 1), recentEntry(null, 0)])),
      }),
    );

    expect(value).toBe(1);
  });

  it('reads zero when the log is empty', async () => {
    const value = await countDistinctAuthorsLowerBound(
      makeConfig(),
      READ_SOURCE,
      stubRpc({ simulateTransaction: async () => simReturning(xdr.ScVal.scvVec([])) }),
    );

    expect(value).toBe(0);
  });

  it('reads zero when the return value is not a vector', async () => {
    const value = await countDistinctAuthorsLowerBound(
      makeConfig(),
      READ_SOURCE,
      stubRpc({ simulateTransaction: async () => simReturning(xdr.ScVal.scvVoid()) }),
    );

    expect(value).toBe(0);
  });
});
