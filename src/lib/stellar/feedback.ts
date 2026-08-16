import {
  Address,
  BASE_FEE,
  Contract,
  nativeToScVal,
  rpc as SorobanRpc,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { log } from '@/lib/api/logger';
import { stellar } from '@/config/stellar';
import { actionLog } from '@/config/contract';
import { soroban } from './rpc';
import { simulateRead } from './action-log';

const feedback = new Contract(actionLog.feedbackId);

/**
 * Build an unsigned `submit` invoke for the on-chain feedback contract,
 * simulated and assembled. The wallet signs it and {@link submitInvoke}
 * (from `./action-log`) hands it to the network — anchoring a piece of
 * feedback on-chain so it can be independently verified.
 */
export async function buildFeedbackXdr(
  author: string,
  rating: number,
  comment: string,
): Promise<string> {
  const account = await soroban.getAccount(author);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: stellar.networkPassphrase,
  })
    .addOperation(
      feedback.call(
        'submit',
        Address.fromString(author).toScVal(),
        nativeToScVal(rating, { type: 'u32' }),
        nativeToScVal(comment, { type: 'string' }),
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

/** Total feedback entries anchored on-chain. */
export async function getFeedbackCount(): Promise<number> {
  const value = await simulateRead(feedback, 'get_count', []);
  return Number(value ?? 0);
}

/**
 * Runtime guard for one decoded feedback entry. Only `author` is consumed
 * here, so only `author` is checked — but it *is* checked: the simulation
 * result is whatever the deployed contract emitted, and a blind cast would
 * fold `undefined` into the distinct-wallet count.
 */
export function hasAuthor(value: unknown): value is { author: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { author?: unknown }).author === 'string'
  );
}

/** Authors of recent on-chain feedback — folded into the distinct-wallet count. */
export async function getFeedbackAuthors(limit = 20): Promise<string[]> {
  const value = await simulateRead(feedback, 'get_recent', [nativeToScVal(limit, { type: 'u32' })]);
  if (!Array.isArray(value)) return [];
  const authors: string[] = [];
  let skipped = 0;
  for (const entry of value) {
    if (hasAuthor(entry)) authors.push(entry.author);
    else skipped += 1;
  }
  // One structured line per batch: a malformed entry should surface as drift
  // in the logs, not silently shrink (or NaN) the wallet count.
  if (skipped > 0) {
    log('warn', 'feedback.entry_skipped', { source: 'get_recent', skipped, total: value.length });
  }
  return authors;
}
