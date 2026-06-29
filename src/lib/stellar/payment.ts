import {
  Asset,
  BASE_FEE,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { stellar } from '@/config/stellar';
import { horizon } from './client';
import type { PaymentResult } from './types';

/**
 * Build an unsigned native-XLM payment transaction, returned as XDR.
 *
 * The source account is loaded fresh so the sequence number is current; the
 * wallet signs the XDR and {@link submitSignedXdr} hands it to Horizon.
 */
export async function buildPaymentXdr(
  source: string,
  destination: string,
  amount: string,
): Promise<string> {
  const account = await horizon.loadAccount(source);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: stellar.networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination,
        asset: Asset.native(),
        amount,
      }),
    )
    .setTimeout(180)
    .build();
  return tx.toXDR();
}

/** Submit a wallet-signed XDR to Horizon, returning its hash and ledger. */
export async function submitSignedXdr(signedXdr: string): Promise<PaymentResult> {
  const tx = TransactionBuilder.fromXDR(signedXdr, stellar.networkPassphrase);
  const res = await horizon.submitTransaction(tx);
  return { hash: res.hash, ledger: res.ledger };
}
