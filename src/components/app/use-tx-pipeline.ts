'use client';

import { useCallback, useRef, useState } from 'react';
import { useWallet } from '@/components/app/wallet-provider';
import { describeError } from '@/lib/stellar/errors';
import type { TxState } from '@/lib/stellar/types';

/**
 * What a pipeline run resolves to when the chain accepts the transaction.
 *
 * `message` is the optional line the status panel renders under its success
 * heading — the submit step supplies it because only the caller knows what a
 * success is worth saying ("Sent 12.5 XLM."), while the hook only knows that
 * one happened.
 */
export interface TxRunResult {
  hash: string;
  message?: string;
}

/** Errors that carry the hash of a transaction whose outcome is unresolved. */
function errorHash(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'hash' in err) {
    const { hash } = err as { hash?: unknown };
    if (typeof hash === 'string' && hash.length > 0) return hash;
  }
  return undefined;
}

/**
 * The build → sign → submit lifecycle every on-chain form walks.
 *
 * Each form used to sequence these three awaits itself, which meant the phase
 * bookkeeping, the error mapping and the double-submit protection were copied
 * per file and could drift per file. The hook owns all three; a form supplies
 * only the two steps that are actually its own — how to build the XDR and how
 * to submit the signed envelope. Signing always goes through the connected
 * wallet, so the hook takes it from context rather than as a parameter.
 *
 * Guarantees the callers rely on:
 *
 * - **One run at a time.** `run` refuses to start while a run is in flight.
 *   The guard is a ref, not the rendered `inFlight`, so an Enter or a
 *   double-click racing React's re-render is still blocked — a duplicate here
 *   is a duplicate payment or a duplicate on-chain record, not a duplicate
 *   request.
 * - **Unresolved outcomes keep their hash.** An error carrying a `hash`
 *   (a submit timeout, where the network may yet apply the transaction)
 *   surfaces it into the error state so the status panel can link the
 *   explorer instead of inviting a blind — and possibly double — retry.
 * - **Failures speak the shared language.** Every throw is mapped through
 *   {@link describeError} before it reaches the UI.
 */
export function useTxPipeline() {
  const { signTransaction } = useWallet();
  const [tx, setTx] = useState<TxState>({ phase: 'idle' });
  const running = useRef(false);

  const inFlight = tx.phase === 'building' || tx.phase === 'signing' || tx.phase === 'submitting';

  const run = useCallback(
    async (
      build: () => Promise<string>,
      submit: (signedXdr: string) => Promise<TxRunResult>,
    ): Promise<TxRunResult | null> => {
      if (running.current) return null;
      running.current = true;

      try {
        setTx({ phase: 'building' });
        const xdr = await build();

        setTx({ phase: 'signing' });
        const signed = await signTransaction(xdr);

        setTx({ phase: 'submitting' });
        const result = await submit(signed);

        setTx({ phase: 'success', hash: result.hash, message: result.message });
        return result;
      } catch (err: unknown) {
        setTx({ phase: 'error', message: describeError(err), hash: errorHash(err) });
        return null;
      } finally {
        running.current = false;
      }
    },
    [signTransaction],
  );

  /**
   * Report a failure that never reached the pipeline — a disconnected wallet,
   * a field the contract would refuse. Routing these through the same TxState
   * keeps the form to a single status surface instead of one panel for
   * pipeline errors and a second style for everything else.
   */
  const fail = useCallback((message: string) => {
    setTx({ phase: 'error', message });
  }, []);

  const reset = useCallback(() => setTx({ phase: 'idle' }), []);

  return { tx, run, fail, reset, inFlight };
}
