/**
 * Contract-invocation phase of the Zentra load-test harness: one funded account,
 * one `record()` call, build through confirmation.
 *
 * ## Why this restates `src/lib/stellar/action-log.ts` instead of importing it
 *
 * That module is the app's path and resolves its ids through `@/config/contract`
 * — the *live* deployment whose `get_count` `/metrics` presents as adoption.
 * Importing it would aim every synthetic write at exactly the instance the
 * harness promises to stay out of. So the call shapes are copied deliberately
 * (same `BASE_FEE`, same explicit ScVal types, same simulate → assemble → sign →
 * poll sequence) while every contract id arrives through `LoadTestConfig`.
 * The duplication is the safety property; drifting from that module is a bug,
 * because a load test is only worth trusting if it exercises the real path.
 *
 * ## Why `config.reputationId` is never called here
 *
 * `record` fans out to it cross-contract, so every attempt exercises both
 * contracts and simulation covers both footprints. Nothing an attempt returns
 * can prove the pair is wired up, though: the log's `try_bump` deliberately
 * degrades a broken reputation dependency to a score of 0 rather than trapping
 * (see ZEN-01 in `docs/SECURITY-REVIEW.md`), so a mis-wired run still reports
 * clean successes. Verifying the wiring is deployment's job, not the driver's.
 *
 * ## Stage attribution
 *
 * The reason to run this at all is to learn *which layer gave out*, so every
 * failure exits through one `catch` that reports the stage in flight when it
 * happened. `build` covers construction and simulation, `sign` the keypair and
 * signature, `submit` a rejection at the RPC door, `confirm` a transaction the
 * network took but did not carry to success. A deadline is attributed to
 * whichever stage was waiting, because "slow at submit" and "slow to confirm"
 * are different findings.
 *
 * ## Secrets
 *
 * `FundedAccount.secret` reaches exactly one expression here,
 * `Keypair.fromSecret`. Everything that leaves this module as text goes through
 * `sanitiseMessage` first: the SDK is free to quote its own inputs back inside
 * an error string, and a `LoadTestReport` is a committed artefact.
 */

import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  nativeToScVal,
  rpc as SorobanRpc,
  scValToNative,
  type Transaction,
  TransactionBuilder,
  type xdr,
} from '@stellar/stellar-sdk';
import type {
  AttemptFailure,
  FailureStage,
  FundedAccount,
  LoadTestConfig,
  RecordAttempt,
} from './types';

/**
 * The action log's `MAX_MESSAGE_LEN`, in **bytes**.
 *
 * `contracts/zentra-action-log/src/lib.rs` compares `message.len()`, and a
 * soroban-sdk `String` is a byte array — so one emoji spends four of the 200,
 * and `String.length` in JS would overcount the budget. Checked locally before
 * any RPC call so an over-long message costs no round trip and lands as a
 * `build` failure naming the real problem instead of contract error #2.
 */
export const MAX_MESSAGE_BYTES = 200;

/**
 * The action log's `MAX_RECENT`. The contract clamps `get_recent(limit)` to this,
 * so asking for more would only invite a caller to believe the answer covers
 * more than 20 entries.
 */
export const RECENT_WINDOW = 20;

/**
 * Confirmation poll cadence, matching the app's own path. Testnet closes ledgers
 * roughly every 5 s, so this oversamples ~5×: cheap in RPC calls, and it keeps
 * the measured latency tight around the real confirmation rather than smearing
 * it across a coarse poll interval.
 */
const CONFIRM_POLL_MS = 1000;

/**
 * Ceiling on a reported failure message. Soroban error strings can carry a
 * diagnostic-event dump; a report table needs a cause, not a transcript.
 */
const MAX_FAILURE_MESSAGE_CHARS = 300;

const REDACTED = '[redacted]';

/**
 * An ed25519 secret seed in strkey form: `S` plus 55 base32 characters. Public
 * keys (`G`) and contract ids (`C`) are safe to report and deliberately do not
 * match.
 */
const SEED_PATTERN = /\bS[A-Z2-7]{55}\b/g;

/**
 * The slice of `rpc.Server` this phase actually uses.
 *
 * Narrow on purpose. A test supplies four functions and the whole path — real
 * XDR assembly, real signing, real stage attribution — runs with no network.
 * Taking the concrete `rpc.Server` would make the classification logic, the only
 * reason this harness exists, verifiable only against public testnet.
 */
export interface LoadTestRpc {
  getAccount(address: string): Promise<Account>;
  simulateTransaction(tx: Transaction): Promise<SorobanRpc.Api.SimulateTransactionResponse>;
  sendTransaction(tx: Transaction): Promise<SorobanRpc.Api.SendTransactionResponse>;
  getTransaction(hash: string): Promise<SorobanRpc.Api.GetTransactionResponse>;
}

/**
 * The real client, built per call from the run's own URL rather than shared as
 * module state — the harness must be pointable at a throwaway RPC without a
 * process restart, and nothing here may reuse the app's singleton.
 */
export function createRpcClient(rpcUrl: string): LoadTestRpc {
  // `allowHttp` only when the URL asks for plaintext, so a local quickstart RPC
  // works while public testnet keeps its TLS requirement.
  return new SorobanRpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });
}

/**
 * Marks the attempt as cut short rather than faulted, and says which kind.
 *
 * An expired deadline is a finding about the network; a run-level abort (Ctrl-C,
 * an exhausted budget) is a finding about the operator. Wording them the same
 * would file every interrupted run under "timeouts" and overstate what the
 * contracts were struggling with. `AbortSignal.timeout` aborts with a
 * `TimeoutError`, which is what separates the two.
 */
class AttemptAborted extends Error {
  constructor(signal: AbortSignal, timeoutMs: number) {
    const reason = signal.reason as { name?: string } | undefined;
    super(
      reason?.name === 'TimeoutError'
        ? `timed out after ${timeoutMs}ms`
        : 'aborted before completion',
    );
    this.name = 'AttemptAborted';
  }
}

/**
 * Stop waiting on `work` once `signal` aborts.
 *
 * It stops the *waiting*, not the request: the SDK's HTTP client takes no
 * `AbortSignal`, so the socket may well still be open afterwards. That is
 * exactly the requirement — one stuck submission must not hold up a run — and
 * the abandoned promise keeps a rejection handler attached so a late failure
 * cannot surface as an unhandled rejection and take the process down.
 */
function withDeadline<T>(work: Promise<T>, signal: AbortSignal, timeoutMs: number): Promise<T> {
  if (signal.aborted) {
    void work.catch(() => {});
    return Promise.reject(new AttemptAborted(signal, timeoutMs));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new AttemptAborted(signal, timeoutMs));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** Sleep that wakes early on abort, so a poll gap cannot outlive the deadline. */
function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

/**
 * Monotonic elapsed milliseconds. `performance.now` rather than `Date.now`
 * because a clock correction mid-run would otherwise be reported as a negative
 * or absurd latency, and the percentile tables are the point of the run.
 */
function elapsedMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

/**
 * Reduce anything thrown to one safe line.
 *
 * Two passes on purpose. The exact-match pass removes this account's seed even
 * where the pattern's word boundaries would not fire, such as a seed
 * concatenated into a longer token; the pattern pass removes a seed this module
 * never handed over — a mistyped key quoted back by the SDK. The rule is that no
 * seed reaches a report, not that this particular one does not.
 */
function sanitiseMessage(err: unknown, secret: string): string {
  let text = rawMessage(err);
  if (secret.length > 0) {
    text = text.split(secret).join(REDACTED);
  }
  text = text.replace(SEED_PATTERN, REDACTED);
  // Collapsed to one line: these land in a Markdown table, and a raw newline
  // would break the row rather than the message.
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length === 0) {
    return 'unknown failure';
  }
  return text.length > MAX_FAILURE_MESSAGE_CHARS
    ? `${text.slice(0, MAX_FAILURE_MESSAGE_CHARS)}…`
    : text;
}

function rawMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message?: unknown }).message ?? '');
  }
  return String(err ?? '');
}

/**
 * Name the transaction result code when the network attached one.
 *
 * Wrapped because a diagnostic is not worth an exception: an unexpected or
 * absent `resultXdr` must degrade to a vaguer message, never lose the whole
 * attempt record that the report is built from.
 */
function resultCodeSuffix(result: xdr.TransactionResult | undefined): string {
  try {
    const name = result?.result().switch().name;
    return name ? `: ${name}` : '';
  } catch {
    return '';
  }
}

/**
 * Check the message against the contract's bound and encode it.
 *
 * Separate from building so it can run before the sequence-number fetch: a
 * misconfigured message would otherwise burn one RPC round trip per account
 * before failing identically every time.
 */
function recordMessageScVal(message: string): xdr.ScVal {
  const bytes = new TextEncoder().encode(message).length;
  if (bytes === 0) {
    throw new Error('message is empty; the contract rejects that with EmptyMessage');
  }
  if (bytes > MAX_MESSAGE_BYTES) {
    throw new Error(
      `message is ${bytes} bytes; the contract rejects anything over ${MAX_MESSAGE_BYTES}`,
    );
  }
  // Explicit type: an unhinted string can be read as a symbol, and the host
  // rejects the invocation with an error that says nothing about which argument
  // was wrong.
  return nativeToScVal(message, { type: 'string' });
}

/** Build the unsigned `record` invoke. Mirrors `buildRecordXdr`, ids from config. */
function buildRecordTx(
  source: Account,
  author: string,
  message: xdr.ScVal,
  config: LoadTestConfig,
): Transaction {
  return (
    new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(
        new Contract(config.actionLogId).call(
          'record',
          Address.fromString(author).toScVal(),
          message,
        ),
      )
      // The ledger-level validity window has to outlive our own deadline. Set it
      // shorter and a busy network would return `tx_too_late` — a confirmation
      // failure that reads as the contract's fault — before the deadline we
      // actually configured could fire and be reported as the timeout it is.
      .setTimeout(Math.max(30, Math.ceil(config.timeoutMs / 1000) + 30))
      .build()
  );
}

interface Settlement {
  ok: boolean;
  /** Real ledger when the transaction landed, failed or not. Null while unknown. */
  ledger: number | null;
  detail: string;
}

/**
 * Poll an accepted transaction until it settles.
 *
 * `NOT_FOUND` is not a failure: RPC has simply not seen the transaction close
 * yet. Only the deadline ends the wait, which is why the loop is bounded by the
 * signal rather than by a try count — a try count silently changes the effective
 * timeout whenever the poll cadence is tuned.
 */
async function pollForSettlement(
  client: LoadTestRpc,
  hash: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<Settlement> {
  while (!signal.aborted) {
    const got = await withDeadline(client.getTransaction(hash), signal, timeoutMs);

    if (got.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return { ok: true, ledger: got.ledger, detail: '' };
    }
    if (got.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      return {
        ok: false,
        ledger: got.ledger,
        detail: `transaction applied but failed${resultCodeSuffix(got.resultXdr)}`,
      };
    }

    await sleepUnlessAborted(CONFIRM_POLL_MS, signal);
  }

  // Accepted, never seen to close inside the window. Genuinely unknown, so the
  // caller reports the hash it does have and no ledger.
  throw new AttemptAborted(signal, timeoutMs);
}

/**
 * Drive one funded account through a full `record()` invocation.
 *
 * Resolves rather than throws: a load test needs the failed attempts as data,
 * with their latency, exactly as much as it needs the successes.
 *
 * `client` is injectable so the whole path is testable without a network, and
 * `runSignal` composes a run-level abort (Ctrl-C, an overall budget) with the
 * per-attempt deadline instead of replacing it.
 */
export async function recordOnce(
  account: FundedAccount,
  config: LoadTestConfig,
  client: LoadTestRpc = createRpcClient(config.rpcUrl),
  runSignal?: AbortSignal,
): Promise<RecordAttempt> {
  const startedAt = performance.now();
  // Clamped: `AbortSignal.timeout` throws on a non-positive argument, and a
  // misconfigured ceiling must not take down the run before the first attempt.
  const timeoutMs = Math.max(1, Math.floor(config.timeoutMs));
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = runSignal ? AbortSignal.any([deadline, runSignal]) : deadline;

  let stage: FailureStage = 'build';
  let txHash: string | null = null;
  let ledger: number | null = null;

  try {
    const message = recordMessageScVal(config.message);
    // `getAccount` supplies the sequence number, so it is part of construction:
    // an unfunded or missing account fails here and belongs to `build`.
    const source = await withDeadline(client.getAccount(account.publicKey), signal, timeoutMs);
    const unsigned = buildRecordTx(source, account.publicKey, message, config);

    const sim = await withDeadline(client.simulateTransaction(unsigned), signal, timeoutMs);
    if (SorobanRpc.Api.isSimulationError(sim)) {
      throw new Error(`simulation rejected the invoke: ${sim.error}`);
    }
    if (SorobanRpc.Api.isSimulationRestore(sim)) {
      // A restore preamble means simulation succeeded only *as if* archived
      // entries were live. Submitting anyway produces an on-chain failure that
      // would be counted against the contracts, so stop and say what is wrong.
      throw new Error(
        'simulation returned a restore preamble; the action log has archived entries that need restoring before the run',
      );
    }
    // Assembly, not a hand-set fee: simulation is what knows the footprint and
    // resource fee, and a guessed value is the classic source of phantom
    // `confirm` failures.
    const assembled = SorobanRpc.assembleTransaction(unsigned, sim).build();

    stage = 'sign';
    // The author is also the transaction source, so source-account auth
    // satisfies `author.require_auth()` and there is no separate authorisation
    // entry to sign. The cross-contract bump into reputation is auto-authorised
    // for the log itself and needs nothing from this signature either.
    assembled.sign(Keypair.fromSecret(account.secret));

    stage = 'submit';
    const sent = await withDeadline(client.sendTransaction(assembled), signal, timeoutMs);
    if (sent.status === 'ERROR' || sent.status === 'TRY_AGAIN_LATER') {
      // Deliberately no `txHash`: the hash of a transaction the network never
      // accepted resolves nowhere, and reporting it would send a reader hunting
      // an explorer for something that does not exist.
      throw new Error(
        `RPC refused the submission (${sent.status})${resultCodeSuffix(sent.errorResult)}`,
      );
    }

    // PENDING or DUPLICATE. DUPLICATE means this hash is already in flight or
    // already closed, so polling it is the correct next move, not an error.
    txHash = sent.hash;

    stage = 'confirm';
    const settled = await pollForSettlement(client, sent.hash, signal, timeoutMs);
    // Kept even when the transaction failed: knowing which ledger applied the
    // failure is what makes it traceable on an explorer.
    ledger = settled.ledger;
    if (!settled.ok) {
      throw new Error(settled.detail);
    }

    return {
      publicKey: account.publicKey,
      ok: true,
      latencyMs: elapsedMs(startedAt),
      txHash,
      ledger,
      failure: null,
    };
  } catch (err) {
    const failure: AttemptFailure = {
      publicKey: account.publicKey,
      stage,
      message: sanitiseMessage(err, account.secret),
    };
    return {
      publicKey: account.publicKey,
      ok: false,
      // Recorded for failures too: a slow failure is a finding, and dropping it
      // would flatter the percentiles by measuring only what worked.
      latencyMs: elapsedMs(startedAt),
      txHash,
      ledger,
      failure,
    };
  }
}

/**
 * Simulate a read-only call against a contract id from the run's config.
 *
 * `readSource` only has to exist on the network — simulation never signs or
 * submits, so the sequence number is irrelevant and any funded account serves.
 * It is a parameter because `LoadTestConfig` carries no read source and the
 * harness must not fall back to the app's hardcoded one, which belongs to the
 * live deployment.
 */
async function simulateRead(
  client: LoadTestRpc,
  config: LoadTestConfig,
  readSource: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
): Promise<unknown> {
  // Sequence `0` is fine: nothing is signed or submitted, so the only thing
  // simulation needs from this account is that it exists on the network.
  const tx = new TransactionBuilder(new Account(readSource, '0'), {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();

  // `timeoutMs` is a per-operation ceiling, and these reads bracket the run: a
  // stalled `get_count` would hold the whole report open just as surely as a
  // stalled submission holds up an attempt.
  const timeoutMs = Math.max(1, Math.floor(config.timeoutMs));
  const sim = await withDeadline(
    client.simulateTransaction(tx),
    AbortSignal.timeout(timeoutMs),
    timeoutMs,
  );
  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(`read simulation failed for ${method}: ${sim.error}`);
  }
  const retval = SorobanRpc.Api.isSimulationSuccess(sim) ? sim.result?.retval : undefined;
  return retval ? scValToNative(retval) : null;
}

/**
 * The action log's total entry count — the before/after pair a report brackets a
 * run with.
 *
 * Narrowed to `number` because `get_count` returns a `u64`, which decodes to a
 * `bigint` that `JSON.stringify` refuses outright; a report that cannot be
 * serialised is no report. Safe here: the count is many orders of magnitude
 * below `Number.MAX_SAFE_INTEGER`.
 */
export async function readActionLogCount(
  config: LoadTestConfig,
  readSource: string,
  client: LoadTestRpc = createRpcClient(config.rpcUrl),
): Promise<number> {
  const value = await simulateRead(client, config, readSource, config.actionLogId, 'get_count', []);
  return Number(value ?? 0);
}

/**
 * Distinct authors visible through `get_recent` — a **LOWER BOUND**, never a
 * total.
 *
 * The contract clamps `get_recent` to `MAX_RECENT` (20) to bound the read, so a
 * run of 50 accounts can only ever see the newest 20 entries and this returns at
 * most 20 no matter how many accounts actually recorded. The name says
 * `LowerBound` so no caller can quote it as participation, and
 * `LoadTestReport.distinctAuthorsSeen` documents the same caveat for readers of
 * the finished report.
 */
export async function countDistinctAuthorsLowerBound(
  config: LoadTestConfig,
  readSource: string,
  client: LoadTestRpc = createRpcClient(config.rpcUrl),
): Promise<number> {
  const value = await simulateRead(
    client,
    config,
    readSource,
    config.actionLogId,
    'get_recent',
    // u32 explicitly: the contract's `limit` is a `u32` and a mismatched width
    // fails the invocation rather than being coerced.
    [nativeToScVal(RECENT_WINDOW, { type: 'u32' })],
  );
  if (!Array.isArray(value)) {
    return 0;
  }

  const authors = new Set<string>();
  for (const entry of value) {
    const author = (entry as { author?: unknown }).author;
    // Shape-checked rather than trusted: an entry that decoded without an author
    // must be skipped, because adding `undefined` to the set would inflate the
    // figure by one and this number is already only a floor.
    if (typeof author === 'string' && author.length > 0) {
      authors.add(author);
    }
  }
  return authors.size;
}
