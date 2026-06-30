import type { Metadata } from 'next';
import { SCENARIOS } from '@/lib/scenarios';
import { ScenarioPlayer } from '@/components/playground/scenario-player';
import { ProofConsole } from '@/components/playground/proof-console';
import { ZkIntro } from '@/components/playground/zk-intro';
import { ProofVisuals } from '@/components/playground/proof-visuals';
import { ZkGlossary } from '@/components/playground/zk-glossary';
import { Eyebrow } from '@/components/landing/primitives';
import { Footer } from '@/components/landing/footer';

export const metadata: Metadata = {
  title: 'Playground',
  description:
    'Generate a real Groth16 zero-knowledge proof in your browser, verify it on-chain against the live Soroban verifier, and see every proof made on the platform.',
};

export default function PlaygroundPage() {
  return (
    <>
      <section className="zen-grid border-b border-fd-border">
        <div className="mx-auto max-w-5xl px-5 py-14 sm:px-6 sm:py-20">
          <Eyebrow accent="cyan">ZENTRA // PLAYGROUND</Eyebrow>
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Real zero-knowledge proofs, in your browser.
          </h1>
          <p className="mt-4 max-w-2xl text-fd-muted-foreground">
            Generate an actual Groth16 / BN254 proof from the Zentra payment-policy
            circuit, verify it locally, then verify it on-chain against the live
            Soroban verifier — and see every proof made on the platform.
          </p>

          <div className="mt-10">
            <ZkIntro />
          </div>
          <div className="mt-5">
            <ProofVisuals />
          </div>
          <div className="mt-5">
            <ProofConsole />
          </div>
        </div>
      </section>

      <section className="border-b border-fd-border">
        <div className="mx-auto max-w-5xl px-5 py-14 sm:px-6 sm:py-16">
          <Eyebrow>// GUIDED SCENARIOS</Eyebrow>
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
            Or replay the three scenarios.
          </h2>
          <p className="mt-3 max-w-2xl text-sm text-fd-muted-foreground">
            Deterministic replays of the live demo — legitimate payment, prompt
            injection, and over-spend — showing which check fires.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            {SCENARIOS.map((s) => (
              <ScenarioPlayer key={s.id} s={s} />
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-fd-border">
        <div className="mx-auto max-w-5xl px-5 py-14 sm:px-6 sm:py-16">
          <ZkGlossary />
        </div>
      </section>
      <Footer />
    </>
  );
}
