'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Eyebrow, HudPanel } from '@/components/landing/primitives';
import { actionLog } from '@/config/contract';
import { stellar } from '@/config/stellar';
import { truncateAddress } from '@/lib/stellar/format';
import { getProofCount, getRecentProofs } from '@/lib/stellar/proofs';
import type { ProofEntry } from '@/lib/stellar/types';

export function ProofsFeed({ refreshSignal = 0 }: { refreshSignal?: number }) {
  const [count, setCount] = useState<number | null>(null);
  const [proofs, setProofs] = useState<ProofEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const [nextCount, nextProofs] = await Promise.all([getProofCount(), getRecentProofs(20)]);
      if (id !== request.current) return;
      setCount(nextCount);
      setProofs(nextProofs);
    } catch {
      if (id !== request.current) return;
      setError('Could not load the proof registry.');
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Bumping the id drops a reply that lands after this feed is gone.
    return () => {
      request.current += 1;
    };
  }, [load, refreshSignal]);

  return (
    <HudPanel accent="cyan">
      <div className="p-5 sm:p-6">
        <Eyebrow accent="cyan">PROOFS ANCHORED ON-CHAIN</Eyebrow>

        <div
          role="status"
          aria-busy={loading}
          className="flex items-center gap-2 font-mono text-[11px] text-faint"
        >
          <span aria-hidden className="size-1.5 rounded-full bg-live animate-pulse" />
          <span>{count ?? '—'} proof(s) anchored</span>
          <span aria-hidden>·</span>
          <a
            href={stellar.explorerContractUrl(actionLog.proofRegistryId)}
            target="_blank"
            rel="noreferrer"
            className="hover:text-cyan"
          >
            registry
          </a>
        </div>

        {error ? (
          <div
            role="alert"
            className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border border-denied/40 bg-denied/[0.06] px-3 py-2"
          >
            <p className="font-mono text-[11px] text-denied">
              {error}
              {proofs.length > 0 ? ' Showing the last list that loaded.' : ''}
            </p>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="ml-auto border border-violet/50 px-3 py-1 font-mono text-[11px] tracking-wide text-violet-soft transition-colors hover:bg-violet/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'retrying…' : 'retry'}
            </button>
          </div>
        ) : null}

        {loading && proofs.length === 0 ? (
          <p className="mt-4 font-mono text-xs text-muted">Loading the proof registry…</p>
        ) : proofs.length === 0 ? (
          error ? null : (
            <p className="mt-4 font-mono text-xs text-muted">
              No proofs anchored yet — generate one and anchor it.
            </p>
          )
        ) : (
          <ul
            aria-label="Recently anchored proofs"
            className="mt-4 divide-y divide-fd-border border border-fd-border"
          >
            {proofs.map((proof) => (
              <li key={proof.index} className="px-4 py-3">
                <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 font-mono text-[11px] text-faint">
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
