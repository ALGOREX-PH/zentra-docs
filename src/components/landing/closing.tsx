import Link from 'next/link';
import { HudPanel, Eyebrow } from './primitives';

export function Closing() {
  return (
    <section className="border-b border-fd-border">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <Eyebrow>ZENTRA // THE BOUNDARY</Eyebrow>
        <HudPanel accent="cyan" className="p-8">
          <p className="font-display text-xl leading-relaxed sm:text-2xl">
            Zentra is a{' '}
            <span className="text-cyan">proof-of-compliance and settlement layer</span>.
            It is <span className="text-fd-muted-foreground">not</span> an identity
            system, an oracle, a policy author, a key manager, or a full compliance
            engine.
          </p>
        </HudPanel>

        <div className="mt-16 flex flex-col items-center text-center">
          <h2 className="max-w-2xl font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Build a guarded agent in 15 minutes.
          </h2>
          <p className="mt-4 max-w-md text-fd-muted-foreground">
            No proof, no payment — on Stellar testnet today.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/docs/quickstart"
              className="bg-violet px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-violet-bright"
            >
              Start the Quickstart
            </Link>
            <Link
              href="/playground"
              className="border border-fd-border px-6 py-3 text-sm font-medium transition-colors hover:bg-fd-accent"
            >
              Open the playground
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
