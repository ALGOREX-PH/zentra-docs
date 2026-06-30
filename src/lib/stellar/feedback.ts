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
