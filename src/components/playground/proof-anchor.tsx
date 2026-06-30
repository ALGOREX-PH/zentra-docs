'use client';

import { useState } from 'react';
import { useWallet } from '@/components/app/wallet-provider';
import { ConnectButton } from '@/components/app/connect-button';
import { commitProof, buildAnchorXdr } from '@/lib/stellar/proofs';
import { submitInvoke } from '@/lib/stellar/action-log';
import { describeError } from '@/lib/stellar/errors';
import { stellar } from '@/config/stellar';
import { HudPanel, Eyebrow } from '@/components/landing/primitives';
import type { ProofResult } from '@/lib/zk/prover';

type Phase = 'idle' | 'anchoring' | 'done' | 'error';

export function ProofAnchor({
  result,
  onAnchored,
}: {
  result: ProofResult;
  onAnchored?: () => void;
}) {
  const { address, signTransaction } = useWallet();
  const [phase, setPhase] = useState<Phase>('idle');
  const [tx, setTx] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function anchor() {
    if (!address) return;
    setPhase('anchoring');
    setError(null);
    try {
      const commitment = await commitProof(result.publicSignals);
      const xdr = await buildAnchorXdr(address, commitment, result.publicSignals.length);
      const signed = await signTransaction(xdr);
      const hash = await submitInvoke(signed);
      setTx(hash);
      setPhase('done');
      onAnchored?.();
    } catch (err: unknown) {
      setError(describeError(err));
      setPhase('error');
    }
  }

  return (
    <HudPanel accent="violet">
      <div className="p-5 sm:p-6">
        <Eyebrow>ANCHOR ON-CHAIN</Eyebrow>
        <p className="mt-2 max-w-[560px] text-sm text-muted">
          Record this proof&apos;s commitment on Stellar testnet so anyone can verify
          it was made — and it joins the platform&apos;s on-chain proof feed.
        </p>

        {!address ? (
          <div className="mt-4 flex flex-col items-start gap-2">
            <p className="font-mono text-[11px] text-faint">Connect a wallet to anchor.</p>
            <ConnectButton />
          </div>
        ) : phase === 'done' && tx ? (
          <div className="mt-4 flex items-center gap-2 border border-live/40 bg-live/[0.06] px-3 py-2 font-mono text-xs text-live">
            Anchored on-chain ✓
            <a
              href={stellar.explorerTxUrl(tx)}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-cyan hover:underline"
            >
              view tx →
            </a>
          </div>
        ) : (
          <button
            type="button"
            onClick={anchor}
            disabled={phase === 'anchoring'}
            className="mt-4 bg-violet px-5 py-3 font-mono text-xs uppercase tracking-[0.1em] text-white transition-colors hover:bg-[#8b5cf6] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {phase === 'anchoring' ? 'Anchoring…' : 'Anchor proof on-chain'}
          </button>
        )}

        {error ? <p className="mt-3 font-mono text-xs text-denied">{error}</p> : null}
      </div>
    </HudPanel>
  );
}
