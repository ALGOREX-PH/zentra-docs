import Link from 'next/link';
import { ZentraMark } from '@/components/brand/zentra-mark';

export default function HomePage() {
  return (
    <main className="zen-grid relative flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <ZentraMark size={72} title="Zentra Protocol" />

      <h1 className="mt-8 max-w-3xl font-display text-4xl font-bold tracking-tight text-fd-foreground sm:text-6xl">
        Let agents act. Make them prove it.
      </h1>

      <p className="mt-5 max-w-xl text-balance text-fd-muted-foreground sm:text-lg">
        AI agents trigger Stellar payments only after proving, in zero knowledge,
        that they followed your private rules.{' '}
        <span className="text-fd-foreground">No proof, no payment.</span>
      </p>

      <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/docs/quickstart"
          className="bg-violet px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-violet-bright"
        >
          Start building
        </Link>
        <Link
          href="/playground"
          className="border border-fd-border px-5 py-2.5 text-sm font-medium text-fd-foreground transition-colors hover:bg-fd-accent"
        >
          Try the playground
        </Link>
      </div>

      <p className="mt-8 font-mono text-xs tracking-[0.14em] text-fd-muted-foreground">
        <span className="text-cyan">◍</span> Live on Stellar testnet · verified Groth16 in ~26M CPU
      </p>
    </main>
  );
}
