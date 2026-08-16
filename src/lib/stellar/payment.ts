import { Asset, BASE_FEE, type Horizon, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { stellar } from '@/config/stellar';
import { horizon } from './client';
import { SubmitTimeoutError } from './errors';
import type { PaymentResult } from './types';

/**
 * How long to keep checking Horizon for a transaction whose submission timed
 * out. Six polls, five seconds apart: past the couple of ledgers a timed-out
 * transaction usually lands in, without pinning the form open for minutes.
 */
const SETTLE_POLL_ATTEMPTS = 6;
const SETTLE_POLL_INTERVAL_MS = 5_000;

/**
 * How long a fetched network base fee stays fresh. Fees move ledger to ledger,
 * not keystroke to keystroke — a short memo spares Horizon a round-trip per
 * build without pinning a stale fee across a real congestion change.
 */
const BASE_FEE_TTL_MS = 60_000;

let cachedBaseFee: { value: string; fetchedAt: number } | null = null;

/**
 * The network's current base fee in stroops, memoised for {@link BASE_FEE_TTL_MS}.
 *
 * Horizon's fee stats reflect what ledgers actually charge under load; pinning
 * the protocol minimum (`BASE_FEE`, 100 stroops) starves the transaction out
 * of ledgers during surge pricing. When Horizon cannot answer, the minimum is
 * still a valid bid, so failure degrades to `BASE_FEE` rather than blocking
 * the payment — and the fallback is memoised too, so an unhealthy Horizon is
 * not re-asked on every build.
 */
async function currentBaseFee(): Promise<string> {
  const now = Date.now();
  if (cachedBaseFee && now - cachedBaseFee.fetchedAt < BASE_FEE_TTL_MS) {
    return cachedBaseFee.value;
  }
  let value: string;
  try {
    value = String(await horizon.fetchBaseFee());
  } catch {
    value = BASE_FEE;
  }
  cachedBaseFee = { value, fetchedAt: now };
  return value;
}

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
    fee: await currentBaseFee(),
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

/**
 * Submit a wallet-signed XDR to Horizon, returning its hash and ledger.
 *
 * A submission that times out is NOT a failure: Horizon can apply the
 * transaction after the connection died, and reporting "failed" invites a
 * retry that pays twice. The hash is computed client-side before submission,
 * so on a timeout-shaped error the ledger itself is asked for the outcome —
 * only when it stays silent does a {@link SubmitTimeoutError} surface, telling
 * the user to check the explorer before signing again.
 */
export async function submitSignedXdr(signedXdr: string): Promise<PaymentResult> {
  const tx = TransactionBuilder.fromXDR(signedXdr, stellar.networkPassphrase);
  const hash = tx.hash().toString('hex');

  try {
    const res = await horizon.submitTransaction(tx);
    return { hash: res.hash, ledger: res.ledger };
  } catch (err: unknown) {
    if (!isTimeoutShaped(err)) throw err;
    return resolveTimedOutSubmission(hash);
  }
}

/**
 * Whether a submit failure leaves the outcome unknown.
 *
 * Three shapes qualify: an HTTP 504, Horizon's structured `timeout` error
 * body, and a network-level failure with no response at all — the request may
 * have reached Horizon even though the answer never came back. Anything that
 * carries a real Horizon response (400 with `result_codes`, 404, …) is a
 * definite verdict and is not treated as a timeout.
 */
function isTimeoutShaped(err: unknown): boolean {
  const response = (
    err as { response?: { status?: number; data?: { status?: number; type?: string } } }
  )?.response;
  if (!response) return true;
  if (response.status === 504 || response.data?.status === 504) return true;
  return typeof response.data?.type === 'string' && response.data.type.endsWith('/timeout');
}

/**
 * Ask Horizon whether a timed-out submission actually settled.
 *
 * Found and successful means the payment went through — return the normal
 * success shape so the UI never knows the submission wobbled. Found but failed
 * is a definite failure. Never found within the window leaves the outcome
 * genuinely unknown, which only {@link SubmitTimeoutError} states honestly.
 */
async function resolveTimedOutSubmission(hash: string): Promise<PaymentResult> {
  for (let attempt = 0; attempt < SETTLE_POLL_ATTEMPTS; attempt += 1) {
    await delay(SETTLE_POLL_INTERVAL_MS);

    let found: Horizon.ServerApi.TransactionRecord | null = null;
    try {
      found = await horizon.transactions().transaction(hash).call();
    } catch {
      // Not ingested yet (404) or Horizon still unhealthy — neither is a
      // verdict, so the next poll gets to ask again.
    }

    if (found) {
      if (found.successful) return { hash, ledger: found.ledger_attr };
      throw new Error('The payment failed on-chain; only the network fee was charged.');
    }
  }
  throw new SubmitTimeoutError(hash);
}

/** Resolve after `ms`, spacing the settlement polls apart. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
