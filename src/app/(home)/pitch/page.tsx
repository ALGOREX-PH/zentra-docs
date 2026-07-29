import type { Metadata } from 'next';
import { PitchDeck } from '@/components/pitch/pitch-deck';

export const metadata: Metadata = {
  title: 'Pitch',
  description:
    'The Zentra Protocol pitch — the agentic trust gap, proof-gated settlement, and what is live on Stellar today.',
};

/** `/pitch` — the deck judges and ecosystem contacts are pointed at. */
export default function PitchPage() {
  return (
    <main className="zen-grid">
      <PitchDeck />
    </main>
  );
}
