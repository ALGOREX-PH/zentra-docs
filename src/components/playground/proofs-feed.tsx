'use client';

import { useEffect, useState } from 'react';
import { getProofCount, getRecentProofs } from '@/lib/stellar/proofs';
import { truncateAddress } from '@/lib/stellar/format';
import { stellar } from '@/config/stellar';
import { actionLog } from '@/config/contract';
import { HudPanel, Eyebrow } from '@/components/landing/primitives';
import { cn } from '@/lib/cn';
import type { ProofEntry } from '@/lib/stellar/types';

export function ProofsFeed({ refreshSignal = 0 }: { refreshSignal?: number }) {
  const [count, setCount] = useState<number | null>(null);
  const [proofs, setProofs] = useState<ProofEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([getProofCount(), getRecentProofs(20)])
      .then(([nextCount, nextProofs]) => {
        if (cancelled) return;
        setCount(nextCount);
        setProofs(nextProofs);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Could not load the proof registry.');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshSignal]);

  return (
    <HudPanel accent="cyan">
      <div className="p-5 sm:p-6">
        <Eyebrow accent="cyan">PROOFS ANCHORED ON-CHAIN</Eyebrow>

        <div className="flex items-center gap-2 font-mono text-[11px] text-faint">
          <span className="size-1.5 rounded-full bg-live animate-pulse" />
          <span>{count ?? '—'} proof(s) anchored</span>
          <span>·</span>
          <a
            href={stellar.explorerContractUrl(actionLog.proofRegistryId)}
            target="_blank"
            rel="noreferrer"
            className="hover:text-cyan"
          >
            registry
          </a>
        </div>

        {loading && proofs.length === 0 ? (
          <p className="mt-4 font-mono text-xs text-muted">Loading…</p>
        ) : error && proofs.length === 0 ? (
          <p className="mt-4 font-mono text-xs text-denied">{error}</p>
        ) : proofs.length === 0 ? (
          <p className="mt-4 font-mono text-xs text-muted">
            No proofs anchored yet — generate one and anchor it.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-fd-border border border-fd-border">
            {proofs.map((proof) => (
              <li key={proof.index} className="px-4 py-3">
                <div className="flex justify-between font-mono text-[11px] text-faint">
                  <a
                    href={stellar.explorerAccountUrl(proof.prover)}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-cyan"
                  >
                    {truncateAddress(proof.prover)}
                  </a>
                  <span>
                    #{proof.index} · {proof.signals} signals · ledger {proof.ledger}
                  </span>
                </div>
                <div className="mt-1.5 break-all font-mono text-[11px] text-violet-soft">
                  sha256 {proof.commitment.slice(0, 24)}…
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </HudPanel>
  );
}
