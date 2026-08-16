import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  nativeToScVal,
  rpc as SorobanRpc,
  scValToNative,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { log } from '@/lib/api/logger';
import { stellar } from '@/config/stellar';
import { actionLog } from '@/config/contract';
import { soroban } from './rpc';
import { InvokeFailedError, SubmitTimeoutError } from './errors';
import type { ActionEntry } from './types';

const contract = new Contract(actionLog.contractId);

interface RawEntry {
  index: bigint | number;
  author: string;
  message: string;
  ledger: bigint | number;
  score: bigint | number;
}

/** Integers decode as `number` (u32) or `bigint` (u64) depending on width. */
export function isChainInt(value: unknown): value is bigint | number {
  return typeof value === 'bigint' || (typeof value === 'number' && Number.isFinite(value));
}

/**
 * Runtime guard for one decoded action-log entry.
 *
 * Simulation results and event payloads are an API boundary: the values are
 * whatever the deployed contract actually emitted, not what this interface
 * hopes it did. Every consumed field is checked here so a shape drift skips
 * the entry instead of rendering `NaN` rows in the feed.
 */
export function isRawEntry(value: unknown): value is RawEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isChainInt(v.index) &&
    typeof v.author === 'string' &&
    typeof v.message === 'string' &&
    isChainInt(v.ledger) &&
    isChainInt(v.score)
  );
}

function toEntry(raw: RawEntry): ActionEntry {
  return {
    index: Number(raw.index),
    author: raw.author,
    message: raw.message,
    ledger: Number(raw.ledger),
    score: Number(raw.score),
  };
}

/**
 * Decode chain values into entries, dropping any that fail {@link isRawEntry}.
 *
 * Skipped entries are reported once per batch as a structured warn — silently
 * rendering a broken row would hide contract drift, and one line per bad value
 * would flood the console on a malformed batch.
 */
function collectEntries(values: unknown[], source: string): ActionEntry[] {
  const entries: ActionEntry[] = [];
  let skipped = 0;
  for (const value of values) {
    if (isRawEntry(value)) entries.push(toEntry(value));
    else skipped += 1;
  }
  if (skipped > 0) {
    log('warn', 'action_log.entry_skipped', { source, skipped, total: values.length });
  }
  return entries;
}

/** Simulate a read-only call and decode its return value to a native value. */
export async function simulateRead(
  target: Contract,
  method: string,
  args: xdr.ScVal[],
): Promise<unknown> {
  const source = new Account(actionLog.readSource, '0');
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: stellar.networkPassphrase,
  })
    .addOperation(target.call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await soroban.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(sim.error);
  }
  const retval = sim.result?.retval;
  return retval ? scValToNative(retval) : null;
}

/** Total number of actions recorded on-chain. */
export async function getCount(): Promise<number> {
  const value = await simulateRead(contract, 'get_count', []);
  return Number(value ?? 0);
}

/** The most recent entries, newest first. */
export async function getRecent(limit = 20): Promise<ActionEntry[]> {
  const value = await simulateRead(contract, 'get_recent', [
    nativeToScVal(limit, { type: 'u32' }),
  ]);
  if (!Array.isArray(value)) return [];
  return collectEntries(value, 'get_recent');
}

/** Build an unsigned `record` invoke — simulated and assembled — as XDR. */
export async function buildRecordXdr(author: string, message: string): Promise<string> {
  const account = await soroban.getAccount(author);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: stellar.networkPassphrase,
  })
    .addOperation(
      contract.call(
        'record',
        Address.fromString(author).toScVal(),
        nativeToScVal(message, { type: 'string' }),
      ),
    )
    .setTimeout(60)
    .build();

  const sim = await soroban.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(sim.error);
  }
  return SorobanRpc.assembleTransaction(tx, sim).build().toXDR();
}

/** How long a submitted invoke is polled before its outcome is declared unknown. */
const CONFIRM_ATTEMPTS = 30;
const CONFIRM_INTERVAL_MS = 1_000;

/**
 * The ledger-level result code from a transaction result, e.g. `txSorobanInvalid`.
 * Best-effort: an undecodable result must never mask the failure it describes.
 */
function resultCode(result: xdr.TransactionResult | undefined): string {
  try {
    return result?.result().switch().name ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Flatten an ERROR send response into human-readable detail: the result code
 * plus the first few diagnostic event payloads the RPC attached. Diagnostics
 * are free text from the failing host call — usually the only line that tells
 * the user *why* (budget exceeded, auth failed, …) — so they belong in the
 * message rather than in a devtools-only dump.
 */
function describeSendError(sent: SorobanRpc.Api.SendTransactionResponse): string {
  const parts: string[] = [resultCode(sent.errorResult)];
  for (const event of (sent.diagnosticEvents ?? []).slice(0, 3)) {
    try {
      const data = scValToNative(event.event().body().v0().data());
      parts.push(
        typeof data === 'string'
          ? data
          : JSON.stringify(data, (_key, value: unknown) =>
              typeof value === 'bigint' ? value.toString() : value,
            ),
      );
    } catch {
      // A diagnostic that does not decode is advisory only — skip it.
    }
  }
  return parts.join('; ');
}

/**
 * Submit a wallet-signed invoke XDR and wait for it to settle. Returns the hash.
 *
 * Every send status gets an explicit verdict — only `PENDING` earns the
 * confirmation poll. Definite failures throw {@link InvokeFailedError}, which
 * carries the hash whenever the transaction reached the network so the UI can
 * link the explorer; a poll that never finds the transaction throws
 * {@link SubmitTimeoutError} because "did not succeed" would be a lie — the
 * invoke may still land in a later ledger.
 */
export async function submitInvoke(signedXdr: string): Promise<string> {
  const tx = TransactionBuilder.fromXDR(signedXdr, stellar.networkPassphrase);
  const sent = await soroban.sendTransaction(tx);

  if (sent.status === 'ERROR') {
    // Refused at the door: never entered a ledger, so there is no hash worth
    // linking — but the decoded result and diagnostics say why.
    throw new InvokeFailedError(
      `The network refused the transaction (${describeSendError(sent)}).`,
    );
  }
  if (sent.status === 'TRY_AGAIN_LATER') {
    throw new InvokeFailedError(
      'The network is congested and did not accept the transaction. Nothing was submitted — try again in a moment.',
    );
  }
  if (sent.status === 'DUPLICATE') {
    // The same envelope is already in flight (a double-click, usually). The
    // first submission is the live one; polling here would race it and could
    // report a stale verdict, so point at the explorer instead.
    throw new InvokeFailedError(
      'This transaction was already submitted. Check the explorer for its result before signing again.',
      sent.hash,
    );
  }

  let got = await soroban.getTransaction(sent.hash);
  let tries = 0;
  while (got.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND && tries < CONFIRM_ATTEMPTS) {
    await new Promise((resolve) => setTimeout(resolve, CONFIRM_INTERVAL_MS));
    got = await soroban.getTransaction(sent.hash);
    tries += 1;
  }
  if (got.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
    throw new InvokeFailedError(
      `The transaction failed on-chain (${resultCode(got.resultXdr)}). Only the network fee was charged.`,
      sent.hash,
    );
  }
  if (got.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    // Still NOT_FOUND after the whole window: the outcome is unknown, not failed.
    throw new SubmitTimeoutError(
      sent.hash,
      'Confirmation timed out — the transaction may still go through. Check the explorer before signing again.',
    );
  }
  return sent.hash;
}

/** The current ledger sequence — the starting cursor for live events. */
export async function getLatestLedger(): Promise<number> {
  const { sequence } = await soroban.getLatestLedger();
  return sequence;
}

/**
 * The `recorded` topic the deployed action-log contract stamps on every entry
 * event (`#[contractevent(topics = ["recorded"])]` in
 * `contracts/zentra-action-log/src/lib.rs`), pre-encoded once as the base64
 * ScVal segment the RPC topic filter takes.
 */
const RECORDED_TOPIC = xdr.ScVal.scvSymbol('recorded').toXDR('base64');

/** Fetch `recorded` events from `startLedger` onward for the live feed. */
export async function pollEvents(
  startLedger: number,
): Promise<{ entries: ActionEntry[]; latestLedger: number }> {
  const res = await soroban.getEvents({
    startLedger,
    filters: [
      {
        type: 'contract',
        contractIds: [actionLog.contractId],
        // Only `recorded` events decode into entries; filtering server-side
        // keeps any other event the contract may one day emit out of the
        // response instead of arriving here as guard-rejected noise.
        topics: [[RECORDED_TOPIC]],
      },
    ],
  });
  // Decode first, guard second: an event payload that is not even valid ScVal
  // must fail the same way as one with the wrong shape — skipped, not thrown.
  const decoded = res.events.map((event): unknown => {
    try {
      return scValToNative(event.value);
    } catch {
      return undefined;
    }
  });
  return { entries: collectEntries(decoded, 'pollEvents'), latestLedger: res.latestLedger };
}
