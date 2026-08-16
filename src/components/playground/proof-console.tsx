'use client';

import dynamic from 'next/dynamic';
import { Component, useState, type ReactNode } from 'react';
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

interface BoundaryState {
  failed: boolean;
}

/**
 * A browser that cannot run the prover — no WebAssembly, a blocked worker, a
 * missing crypto API — throws while rendering. Catching it here keeps the
 * failure inside the console instead of blanking the whole playground.
 */
class ConsoleBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <HudPanel accent="violet">
        <div role="alert" className="p-5 sm:p-6">
          <Eyebrow>PROOF CONSOLE UNAVAILABLE</Eyebrow>
          <p className="text-sm text-muted">
            The console stopped responding in this browser — usually a blocked Web Worker or missing
            WebAssembly support. Reload the page to start over; nothing was sent anywhere.
          </p>
        </div>
      </HudPanel>
    );
  }
}

/** Composes the proof lab and the on-chain proof feed, refreshing the feed
 * whenever a new proof is anchored. */
export function ProofConsole() {
  const [refresh, setRefresh] = useState(0);

  return (
    <ConsoleBoundary>
      <div className="space-y-5">
        <ProofLab onAnchored={() => setRefresh((r) => r + 1)} />
        <ProofsFeed refreshSignal={refresh} />
      </div>
    </ConsoleBoundary>
  );
}
