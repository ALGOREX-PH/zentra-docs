/**
 * Turns a client-supplied transaction hash into a checked fact.
 *
 * A `txHash` that arrives in a request body is a *claim*, not evidence. It is
 * trivial to mint 64 well-formed hex characters, so validating the shape of a
 * hash proves only that the client can count — anyone could post a fabricated
 * hash and earn a "verified on-chain" badge, inflating the on-chain counts that
 * the summary reports. This module asks Horizon whether the transaction really
 * exists, really succeeded, and really came from the wallet doing the claiming.
 *
 * The verdict is the whole product here: this module never rejects, throws or
 * writes anything. The caller decides what a negative verdict means — downgrade
 * `onChain` to false, refuse the write, or surface a message — because that
 * policy belongs to the route, not to the lookup.
 */

import { stellar } from '@/config/stellar';
import { log } from '@/lib/api/logger';

/** The outcome of checking a transaction hash against Horizon. */
export type AnchorVerdict =
  | { verified: true; sourceAccount: string }
  | { verified: false; reason: 'not_found' | 'failed' | 'wrong_account' | 'unavailable' };

/** How long to wait on Horizon before giving up and reporting it unavailable. */
export const ANCHOR_TIMEOUT_MS = 3000;

/**
 * Check `txHash` against Horizon, optionally requiring `wallet` to be its source.
 *
 * Resolves rather than throws for every failure mode — a timeout, a network
 * error or a bad gateway all collapse to `unavailable`, which is deliberately
 * distinct from `not_found`: Horizon being down is not evidence against the
 * user. A `wallet` of `null` skips the ownership check and confirms only that
 * the transaction exists and succeeded. Every negative verdict is logged once.
 */
export async function verifyAnchor(txHash: string, wallet: string | null): Promise<AnchorVerdict> {
  const verdict = await lookup(txHash, wallet);

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
async function lookup(txHash: string, wallet: string | null): Promise<AnchorVerdict> {
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

    const { successful, source_account: sourceAccount } = body as {
      successful?: unknown;
      source_account?: unknown;
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
