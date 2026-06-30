import {
  Address,
  BASE_FEE,
  Contract,
  nativeToScVal,
  rpc as SorobanRpc,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
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

/** Authors of recent on-chain feedback — folded into the distinct-wallet count. */
export async function getFeedbackAuthors(limit = 20): Promise<string[]> {
  const value = await simulateRead(feedback, 'get_recent', [
    nativeToScVal(limit, { type: 'u32' }),
  ]);
  if (!Array.isArray(value)) return [];
  return value.map((entry) => (entry as { author: string }).author);
}
