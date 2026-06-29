import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  nativeToScVal,
  rpc as SorobanRpc,
  scValToNative,
  TransactionBuilder,
  type xdr,
} from '@stellar/stellar-sdk';
import { stellar } from '@/config/stellar';
import { actionLog } from '@/config/contract';
import { soroban } from './rpc';
import type { ActionEntry } from './types';

const contract = new Contract(actionLog.contractId);

interface RawEntry {
  index: bigint | number;
  author: string;
  message: string;
  ledger: number;
  score: bigint | number;
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

/** Simulate a read-only call and decode its return value to a native value. */
async function simulateRead(method: string, args: xdr.ScVal[]): Promise<unknown> {
  const source = new Account(actionLog.readSource, '0');
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: stellar.networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
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
  const value = await simulateRead('get_count', []);
  return Number(value ?? 0);
}

/** The most recent entries, newest first. */
export async function getRecent(limit = 20): Promise<ActionEntry[]> {
  const value = await simulateRead('get_recent', [nativeToScVal(limit, { type: 'u32' })]);
  if (!Array.isArray(value)) return [];
  return value.map((raw) => toEntry(raw as RawEntry));
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

/** Submit a wallet-signed invoke XDR and wait for it to settle. Returns the hash. */
export async function submitInvoke(signedXdr: string): Promise<string> {
  const tx = TransactionBuilder.fromXDR(signedXdr, stellar.networkPassphrase);
  const sent = await soroban.sendTransaction(tx);
  if (sent.status === 'ERROR') {
    throw new Error('The network rejected the transaction.');
  }

  let got = await soroban.getTransaction(sent.hash);
  let tries = 0;
  while (got.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND && tries < 30) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    got = await soroban.getTransaction(sent.hash);
    tries += 1;
  }
  if (got.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error('The transaction did not succeed.');
  }
  return sent.hash;
}

/** The current ledger sequence — the starting cursor for live events. */
export async function getLatestLedger(): Promise<number> {
  const { sequence } = await soroban.getLatestLedger();
  return sequence;
}

/** Fetch `recorded` events from `startLedger` onward for the live feed. */
export async function pollEvents(
  startLedger: number,
): Promise<{ entries: ActionEntry[]; latestLedger: number }> {
  const res = await soroban.getEvents({
    startLedger,
    filters: [{ type: 'contract', contractIds: [actionLog.contractId] }],
  });
  const entries = res.events.map((event) => toEntry(scValToNative(event.value) as RawEntry));
  return { entries, latestLedger: res.latestLedger };
}
