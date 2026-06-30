'use client';

import { useState } from 'react';
import { ProofLab } from '@/components/playground/proof-lab';
import { ProofsFeed } from '@/components/playground/proofs-feed';

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
