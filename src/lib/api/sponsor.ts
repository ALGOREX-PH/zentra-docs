/**
 * Fee sponsorship — letting an account with no XLM still transact.
 *
 * The user signs an ordinary inner transaction they cannot afford to submit;
 * this module wraps it in a fee-bump whose *fee source* is an account we own,
 * so the network charges us and not them. The user's signature is untouched and
 * still authorises exactly what they signed: a fee-bump changes who pays, never
 * what happens.
 *
 * Three rules hold everywhere in this file.
 *
 * 1. The secret in `SPONSOR_SECRET` is never logged, never returned, never
 *    embedded in an error message, and never surfaced through any export. The
 *    only thing about the sponsor that leaves this module is its public `G…`
 *    address, which is chain-public by construction. Every `Keypair.fromSecret`
 *    call sits inside a `try`/`catch` that discards the thrown value, because
 *    a parse failure could otherwise carry the malformed secret into a stack.
 *
 * 2. Unconfigured means refuse. An absent or unparseable secret makes
 *    `isSponsorConfigured()` false and `buildFeeBump()` throw; there is no
 *    value of the environment that turns sponsorship on by accident, and no
 *    path where a missing secret silently degrades into "sponsor anything".
 *
 * 3. **This account holds real value.** Every granted request spends lumens
 *    that nobody gets back. Fund it with only what you are willing to lose,
 *    treat the balance as the blast radius of a bug in `inspectInnerTransaction`,
 *    and rotate the key the moment it is even suspected of having leaked.
 */

import {
  Address,
  BASE_FEE,
  FeeBumpTransaction,
  Keypair,
  TransactionBuilder,
  type OperationRecord,
  type Transaction,
} from '@stellar/stellar-sdk';

import { actionLog } from '@/config/contract';
import { stellar } from '@/config/stellar';

/** Name of the environment variable holding the sponsor account's secret seed. */
export const SPONSOR_SECRET_ENV = 'SPONSOR_SECRET';

/**
 * Ceiling on the inner transaction's declared fee, in stroops — 0.1 XLM.
 *
 * A fee is a *bid*: the ledger charges what inclusion actually required, not
 * the full amount declared. The cap therefore bounds the worst case rather than
 * the normal case, and its job is to stop one request from draining the sponsor
 * on its own. Note the arithmetic of a bump: the envelope this module builds
 * declares `baseFee × (operations + 1) + resourceFee`, so a single-operation
 * inner transaction bidding the maximum produces a bump bidding roughly twice
 * it. Size the sponsor balance against that, not against this constant alone.
 */
export const MAX_SPONSORED_FEE_STROOPS = 1_000_000;

/** Whether a transaction may be sponsored, and the one-word record of why. */
export interface SponsorDecision {
  allowed: boolean;
  reason:
    | 'ok'
    | 'not_configured'
    | 'malformed'
    | 'fee_too_high'
    | 'operation_not_allowed'
    | 'wrong_network';
}

/**
 * The only contracts we will pay fees for: the ones we deployed.
 *
 * This set is the whole security model of the endpoint. Without it, a route
 * that fee-bumps whatever XDR it is handed is a free, open faucet — anyone can
 * sign a payment to themselves, an account merge, a trustline change or an
 * invocation of some unrelated contract, post it here, and have us pay for it
 * until the balance is gone. There is no rate limit tight enough to fix that,
 * because the attacker's cost per attempt is zero and ours is not. Restricting
 * the *target* of every operation to our own contracts is what turns "we pay
 * for anything" into "we pay for our own product being used".
 *
 * Built from `@/config/contract` so a redeploy that changes an id cannot leave
 * a stale allowlist behind. `deployLedger` and `readSource` are deliberately
 * not members: one is a number and the other is an account, and neither is a
 * contract we would ever be invoked against.
 */
const SPONSORABLE_CONTRACT_IDS: ReadonlySet<string> = new Set<string>([
  actionLog.contractId,
  actionLog.reputationId,
  actionLog.feedbackId,
  actionLog.proofRegistryId,
]);

/**
 * Whether a usable sponsor account is configured on this deployment.
 *
 * True only when `SPONSOR_SECRET` holds a non-empty, well-formed Stellar secret
 * seed that can actually sign. Blank and whitespace-only values count as absent
 * — an empty `SPONSOR_SECRET=` line must not read as configured — and a
 * malformed seed is treated the same way rather than being allowed to throw out
 * of a status check.
 */
export function isSponsorConfigured(): boolean {
  return loadSponsor() !== null;
}

/**
 * The sponsor's `G…` address, or null when no usable secret is configured.
 *
 * Safe to publish: the address is what the ledger shows as the fee source of
 * every bump we sign, so returning it tells a client nothing it could not read
 * off-chain. The seed it was derived from never leaves this module.
 */
export function sponsorPublicKey(): string | null {
  return loadSponsor()?.publicKey() ?? null;
}

/**
 * Decide whether an inner transaction is one we are willing to pay for.
 *
 * Resolves to a decision for every possible input and never throws — callers
 * treat any non-`ok` reason as a refusal, so an unexpected shape must produce a
 * verdict rather than an exception that a route would have to guess about.
 *
 * The checks run cheapest-and-most-fundamental first: something that will not
 * parse is `malformed`, something signed for another chain is `wrong_network`,
 * something bidding more than we will spend is `fee_too_high`, and anything
 * that is not an invocation of one of our own contracts is
 * `operation_not_allowed`. `not_configured` is never returned from here — that
 * is a property of the deployment, not of the transaction, and belongs to the
 * caller that checked `isSponsorConfigured()`.
 */
export function inspectInnerTransaction(xdr: string): SponsorDecision {
  try {
    const parsed = TransactionBuilder.fromXDR(xdr, stellar.networkPassphrase);

    // Already a bump. Re-wrapping one is not a thing the protocol allows, and
    // an envelope that arrives in this shape is either a confused client or
    // somebody probing for a way to hide the real inner transaction from the
    // operation gate below.
    if (parsed instanceof FeeBumpTransaction) return refuse('malformed');

    const inner: Transaction = parsed;

    if (!signedForThisNetwork(inner)) return refuse('wrong_network');

    // `Transaction.fee` is the total the envelope bids, already multiplied out
    // across its operations. A non-numeric or negative value is nonsense we
    // will not sign for either.
    const fee = Number(inner.fee);
    if (!Number.isFinite(fee) || fee < 0 || fee > MAX_SPONSORED_FEE_STROOPS) {
      return refuse('fee_too_high');
    }

    // An empty operation list costs us a fee and achieves nothing, so it is a
    // refusal rather than a vacuous pass over the loop below.
    if (inner.operations.length === 0) return refuse('operation_not_allowed');

    for (const operation of inner.operations) {
      if (!targetsOurContract(operation)) return refuse('operation_not_allowed');
    }

    return { allowed: true, reason: 'ok' };
  } catch {
    // Malformed base64, truncated XDR, an envelope variant this SDK cannot
    // read: all of them are the same answer to the caller, and none of them
    // are worth propagating as an exception.
    return refuse('malformed');
  }
}

/**
 * Wrap `xdr` in a fee-bump paid for by the sponsor and return the signed envelope.
 *
 * **Assumes `inspectInnerTransaction(xdr)` already returned `ok`.** This
 * function performs no abuse checks of its own beyond what it needs to build a
 * valid envelope — calling it on unvetted XDR spends real lumens on whatever
 * that XDR happens to be. Throws when no usable secret is configured, or when
 * the SDK refuses to build or sign the bump; neither message carries the
 * secret, the XDR, or any part of either.
 *
 * The returned envelope is signed by the sponsor only. The inner transaction
 * keeps whatever signatures it arrived with, which is the point: we are paying
 * for the user's transaction, not authoring one.
 */
export function buildFeeBump(xdr: string): string {
  // Read and derived on every call, never memoised into a module-level `const`.
  // A cached keypair would outlive a rotation: the operator swaps the value in
  // the environment, the running instance keeps signing with the compromised
  // key it captured at import time, and the rotation silently does nothing
  // until the next cold start. The derivation is cheap; the failure is not.
  const sponsor = loadSponsor();
  if (sponsor === null) {
    throw new Error('Fee sponsorship is not configured.');
  }

  const parsed = TransactionBuilder.fromXDR(xdr, stellar.networkPassphrase);
  if (parsed instanceof FeeBumpTransaction) {
    throw new Error('Inner transaction is already a fee-bump.');
  }

  const bump = TransactionBuilder.buildFeeBumpTransaction(
    sponsor,
    String(feeBumpBaseFee(parsed)),
    parsed,
    stellar.networkPassphrase,
  );
  bump.sign(sponsor);

  return bump.toXDR();
}

/** A refusal carrying `reason`, so no call site has to remember `allowed: false`. */
function refuse(reason: SponsorDecision['reason']): SponsorDecision {
  return { allowed: false, reason };
}

/**
 * Derive the sponsor keypair from the environment, or null if there is not one.
 *
 * Every failure mode collapses to null: unset, blank, whitespace, malformed
 * seed, or a key that cannot sign. The `catch` is empty on purpose — the value
 * `Keypair.fromSecret` throws is discarded rather than inspected, so a bad
 * secret can never be echoed into a log line or an error message through it.
 */
function loadSponsor(): Keypair | null {
  const secret = (process.env[SPONSOR_SECRET_ENV] ?? '').trim();
  if (secret.length === 0) return null;

  try {
    const keypair = Keypair.fromSecret(secret);
    return keypair.canSign() ? keypair : null;
  } catch {
    return null;
  }
}

/**
 * Whether every signature on `tx` verifies against the network we are on.
 *
 * A network passphrase is not stored in an envelope — it is mixed into the hash
 * that gets signed. So the only evidence that a transaction was built for our
 * chain is that its signatures check out under our passphrase, and a
 * transaction signed for the other network fails that check. An unsigned inner
 * transaction carries no evidence either way and is not blocked here; nor is
 * one sourced from a muxed (`M…`) account, which has no single key to test
 * against. That looseness is affordable because this check is a courtesy, not
 * the defence: a bump wrapping a transaction the network will reject is never
 * included in a ledger and so is never charged a fee. The defence against
 * actually losing money is the contract allowlist.
 */
function signedForThisNetwork(tx: Transaction): boolean {
  if (tx.signatures.length === 0) return true;

  let source: Keypair;
  try {
    source = Keypair.fromPublicKey(tx.source);
  } catch {
    return true;
  }

  const hash = tx.hash();
  return tx.signatures.some((signature) => {
    try {
      return source.verify(hash, signature.signature());
    } catch {
      return false;
    }
  });
}

/**
 * Whether `operation` is an invocation of a contract we deployed.
 *
 * Deliberately narrow. A classic operation of any kind — payment, account
 * merge, change-trust, create-account — is false, because none of them are our
 * product being used and all of them are things an attacker would rather we
 * paid for. So are the non-invoke host functions: uploading Wasm and creating
 * contracts are expensive, are nothing a dApp user does, and would let someone
 * push arbitrary code on-chain at our expense.
 *
 * The gate is on the *root* invocation. Our contracts do make cross-contract
 * calls (the action log bumps the reputation contract), and those are reached
 * without appearing here — which is correct: trusting what our own contracts
 * call onward is trusting our own code, whereas trusting an arbitrary root
 * target is trusting a stranger's.
 */
function targetsOurContract(operation: OperationRecord): boolean {
  if (operation.type !== 'invokeHostFunction') return false;

  const func = operation.func;
  if (func.switch().name !== 'hostFunctionTypeInvokeContract') return false;

  try {
    const target = Address.fromScAddress(func.invokeContract().contractAddress()).toString();
    return SPONSORABLE_CONTRACT_IDS.has(target);
  } catch {
    // An address we cannot decode is an address we cannot match against the
    // allowlist, which means it is not on it.
    return false;
  }
}

/**
 * The per-operation base fee to bid on the bump.
 *
 * The SDK requires this to be at least the inner transaction's *inclusion* fee
 * per operation and at least `BASE_FEE`. Bidding the inner transaction's whole
 * fee per operation clears the first bound without having to re-derive the
 * Soroban resource fee out of the envelope, and the clamp to
 * `MAX_SPONSORED_FEE_STROOPS` cannot bind after an `ok` decision — that check
 * already bounded the inner fee by the same constant — so it costs nothing and
 * still holds if this is ever called directly.
 */
function feeBumpBaseFee(inner: Transaction): number {
  const operations = Math.max(1, inner.operations.length);
  const innerFee = Number(inner.fee);
  const perOperation = Number.isFinite(innerFee) ? Math.ceil(innerFee / operations) : 0;

  return Math.min(MAX_SPONSORED_FEE_STROOPS, Math.max(Number(BASE_FEE), perOperation));
}
