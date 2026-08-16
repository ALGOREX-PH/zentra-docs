/**
 * Turns a client-supplied transaction hash into a checked fact.
 *
 * A `txHash` that arrives in a request body is a *claim*, not evidence. It is
 * trivial to mint 64 well-formed hex characters, so validating the shape of a
 * hash proves only that the client can count — anyone could post a fabricated
 * hash and earn a "verified on-chain" badge, inflating the on-chain counts that
 * the summary reports. This module asks Horizon whether the transaction really
 * exists, really succeeded, really came from the wallet doing the claiming, and
 * really invoked the contract the badge is about — a hash that merely names
 * somebody's unrelated payment anchors nothing.
 *
 * The verdict is the whole product here: this module never rejects, throws or
 * writes anything. The caller decides what a negative verdict means — downgrade
 * `onChain` to false, refuse the write, or surface a message — because that
 * policy belongs to the route, not to the lookup.
 */

import { Address, xdr } from '@stellar/stellar-sdk';
import { stellar } from '@/config/stellar';
import { log } from '@/lib/api/logger';
import { isTxHash } from '@/lib/api/validation';

/** The outcome of checking a transaction hash against Horizon. */
export type AnchorVerdict =
  | { verified: true; sourceAccount: string }
  | {
      verified: false;
      reason: 'not_found' | 'failed' | 'wrong_account' | 'wrong_contract' | 'unavailable';
    };

/** How long to wait on Horizon before giving up and reporting it unavailable. */
export const ANCHOR_TIMEOUT_MS = 3000;

/**
 * Check `txHash` against Horizon, requiring `expectedContract` to be what it
 * invoked and — when supplied — `wallet` to be its source.
 *
 * Resolves rather than throws for every failure mode — a timeout, a network
 * error or a bad gateway all collapse to `unavailable`, which is deliberately
 * distinct from `not_found`: Horizon being down is not evidence against the
 * user. A `wallet` of `null` skips the ownership check and confirms only that
 * the transaction exists, succeeded and invoked the expected contract. Every
 * negative verdict is logged once.
 */
export async function verifyAnchor(
  txHash: string,
  wallet: string | null,
  expectedContract: string,
): Promise<AnchorVerdict> {
  const verdict = await lookup(txHash, wallet, expectedContract);

  if (!verdict.verified) {
    log('warn', 'anchor.unverified', { txHash, reason: verdict.reason });
  }

  return verdict;
}

/**
 * Perform the Horizon lookup and map the response onto a verdict.
 *
 * Split out from `verifyAnchor` so that logging happens at exactly one place
 * regardless of which of the many negative paths produced the verdict.
 */
async function lookup(
  txHash: string,
  wallet: string | null,
  expectedContract: string,
): Promise<AnchorVerdict> {
  // The hash is pasted into a URL *path*, so its shape is re-checked here and
  // not merely at the route that happens to call this today. A value that is
  // not 64 hex characters can contain a `/` or a `..` and address some other
  // Horizon endpoint entirely — turning a transaction lookup into a request for
  // whatever the caller named, whose response would then be read as if it were
  // a transaction. Every route already validates before calling, so this is the
  // guard for the next caller rather than for the current ones: nothing here
  // relies on the caller having done it. `not_found` is the honest verdict,
  // because a string that cannot be a hash cannot name a transaction.
  if (!isTxHash(txHash)) return { verified: false, reason: 'not_found' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ANCHOR_TIMEOUT_MS);

  try {
    const response = await fetch(`${stellar.horizonUrl}/transactions/${txHash}`, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });

    if (response.status === 404) return { verified: false, reason: 'not_found' };
    if (!response.ok) return { verified: false, reason: 'unavailable' };

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { verified: false, reason: 'unavailable' };
    }

    if (typeof body !== 'object' || body === null) {
      return { verified: false, reason: 'unavailable' };
    }

    const {
      successful,
      source_account: sourceAccount,
      envelope_xdr: envelopeXdr,
    } = body as {
      successful?: unknown;
      source_account?: unknown;
      envelope_xdr?: unknown;
    };

    // A transaction can be included in a ledger and still have failed; that is
    // an anchor of nothing.
    if (successful !== true) return { verified: false, reason: 'failed' };

    // A 200 without a source account is a response we do not understand, so it
    // is treated as no answer rather than as a pass.
    if (typeof sourceAccount !== 'string' || sourceAccount.length === 0) {
      return { verified: false, reason: 'unavailable' };
    }

    // A hash that exists but belongs to somebody else is not proof this wallet
    // did anything — otherwise any public hash could be replayed as your own.
    if (wallet !== null && sourceAccount !== wallet) {
      return { verified: false, reason: 'wrong_account' };
    }

    // Exists, succeeded and sourced from this wallet still describes almost
    // every transaction the wallet ever made. The badge claims something
    // narrower — a call to the feedback contract — so the envelope is decoded
    // and its operations searched for an invocation of exactly that contract:
    // a hash of some unrelated payment must not anchor anything (BE-01). An
    // envelope we cannot read is no answer rather than a pass, the same
    // posture as a 200 missing its source account.
    const invocation = invokesContract(envelopeXdr, expectedContract);
    if (invocation === 'unparseable') return { verified: false, reason: 'unavailable' };
    if (invocation === 'no') return { verified: false, reason: 'wrong_contract' };

    return { verified: true, sourceAccount };
  } catch {
    // Abort from the timeout above, DNS failure, TLS error, connection reset.
    return { verified: false, reason: 'unavailable' };
  } finally {
    // Runs on every path, so a fast response never leaves a timer pending and
    // holding the event loop open.
    clearTimeout(timer);
  }
}

/**
 * Whether the transaction envelope invokes `contractId` in any operation.
 *
 * Horizon's word that a transaction succeeded says nothing about *what* it
 * did; the envelope does. It is decoded here and its operations walked for an
 * `invokeHostFunction` whose target is the expected contract. A fee-bump
 * envelope merely pays for the transaction that did the work, so the walk
 * descends into the inner envelope (which the protocol fixes at v1); a v0
 * envelope predates Soroban entirely and cannot have invoked any contract.
 *
 * `unparseable` — an absent or undecodable envelope — is kept distinct from
 * `no` so the caller can fail safe as `unavailable` rather than accusing the
 * transaction of naming the wrong contract: a record we cannot read is no
 * answer, not evidence.
 */
function invokesContract(envelopeXdr: unknown, contractId: string): 'yes' | 'no' | 'unparseable' {
  if (typeof envelopeXdr !== 'string' || envelopeXdr.length === 0) return 'unparseable';

  try {
    const envelope = xdr.TransactionEnvelope.fromXDR(envelopeXdr, 'base64');

    let transaction: xdr.Transaction;
    switch (envelope.switch().name) {
      case 'envelopeTypeTx':
        transaction = envelope.v1().tx();
        break;
      case 'envelopeTypeTxFeeBump':
        transaction = envelope.feeBump().tx().innerTx().v1().tx();
        break;
      default:
        return 'no';
    }

    for (const operation of transaction.operations()) {
      const body = operation.body();
      if (body.switch().name !== 'invokeHostFunction') continue;

      const hostFunction = body.invokeHostFunctionOp().hostFunction();
      if (hostFunction.switch().name !== 'hostFunctionTypeInvokeContract') continue;

      const invoked = Address.fromScAddress(hostFunction.invokeContract().contractAddress());
      if (invoked.toString() === contractId) return 'yes';
    }

    return 'no';
  } catch {
    // Base64 that is not an envelope, XDR that does not decode.
    return 'unparseable';
  }
}
