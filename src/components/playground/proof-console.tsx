'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { ProofLab } from '@/components/playground/proof-lab';
import { HudPanel, Eyebrow } from '@/components/landing/primitives';

/**
 * The feed reads Soroban RPC through the Stellar SDK, which is far too heavy
 * for the playground's first bundle. It renders a loading state on its own
 * first paint anyway, so nothing is lost by fetching the chunk after hydration.
 */
const ProofsFeed = dynamic(
  () => import('@/components/playground/proofs-feed').then((m) => m.ProofsFeed),
  {
    ssr: false,
    loading: () => (
      <HudPanel accent="cyan">
        <div className="p-5 sm:p-6">
          <Eyebrow accent="cyan">PROOFS ANCHORED ON-CHAIN</Eyebrow>
          <p className="font-mono text-xs text-muted">Loading the proof registry…</p>
        </div>
      </HudPanel>
    ),
  },
);

/** Composes the proof lab and the on-chain proof feed, refreshing the feed
 * whenever a new proof is anchored. */
export function ProofConsole() {
  const [refresh, setRefresh] = useState(0);

  return (
    <div className="space-y-5">
      <ProofLab onAnchored={() => setRefresh((r) => r + 1)} />
      <ProofsFeed refreshSignal={refresh} />
    </div>
  );
}
