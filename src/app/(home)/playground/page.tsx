import type { Metadata } from 'next';
import { SCENARIOS } from '@/lib/scenarios';
import { ScenarioPlayer } from '@/components/playground/scenario-player';
import { Eyebrow, HudPanel } from '@/components/landing/primitives';
import { Footer } from '@/components/landing/footer';
import { stellarExpertContractUrl } from '@/config/protocol';

export const metadata: Metadata = {
  title: 'Playground',
  description:
    'Run the three Zentra scenarios — legitimate payment, prompt injection, and over-spend — and watch which check fires.',
};

export default function PlaygroundPage() {
  return (
    <>
      <section className="zen-grid border-b border-fd-border">
        <div className="mx-auto max-w-5xl px-5 py-14 sm:px-6 sm:py-20">
          <Eyebrow accent="cyan">ZENTRA // PLAYGROUND</Eyebrow>
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            See the proof rail decide.
          </h1>
          <p className="mt-4 max-w-2xl text-fd-muted-foreground">
            Run each scenario to watch the status timeline and the check that fires.
            These guided replays use the same fixtures as the live demo —
            deterministic and offline-capable.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            {SCENARIOS.map((s) => (
              <ScenarioPlayer key={s.id} s={s} />
            ))}
          </div>

          <HudPanel className="mt-8 p-6">
            <div className="font-mono text-xs tracking-[0.12em] text-fd-muted-foreground">
              ADVANCED // REAL PROOF
            </div>
            <p className="mt-3 max-w-2xl text-sm text-fd-muted-foreground">
              An opt-in mode that generates a <em>real</em> Groth16 proof in your
              browser (snarkjs in a Web Worker) and verifies it against the embedded
              verifying key is coming. The guided replays above are the canonical,
              zero-dependency experience for evaluators.
            </p>
            <a
              href={stellarExpertContractUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-block font-mono text-xs text-cyan hover:underline"
            >
              ◍ Inspect the live verifier on Stellar Expert →
            </a>
          </HudPanel>
        </div>
      </section>
      <Footer />
    </>
  );
}
