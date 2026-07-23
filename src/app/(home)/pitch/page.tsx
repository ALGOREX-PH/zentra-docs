import type { Metadata } from 'next';
import { PitchDeck } from '@/components/pitch/pitch-deck';
import { Footer } from '@/components/landing/footer';

export const metadata: Metadata = {
  title: 'Pitch',
  description:
    'The Zentra Protocol pitch — the agentic trust gap, proof-gated settlement, and what is live on Stellar today.',
};

/** `/pitch` — the deck judges and ecosystem contacts are pointed at. */
export default function PitchPage() {
  return (
    <>
      <main className="zen-grid">
        <PitchDeck />
      </main>
      {/* The footer is site chrome, not a slide — it stays out of the PDF. */}
      <div className="print:hidden">
        <Footer />
      </div>
    </>
  );
}
