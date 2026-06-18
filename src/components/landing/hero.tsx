import Link from 'next/link';
import { ZentraMark } from '@/components/brand/zentra-mark';
import { protocol, stellarExpertContractUrl } from '@/config/protocol';

export function Hero() {
  return (
    <section className="zen-grid relative overflow-hidden border-b border-fd-border">
      <div className="mx-auto flex max-w-5xl flex-col items-center px-6 py-28 text-center sm:py-36">
        <div className="mb-8 flex items-center gap-2.5">
          <ZentraMark size={40} title="Zentra Protocol" />
          <span className="font-display text-lg font-bold tracking-[0.04em]">ZENTRA</span>
          <span className="font-mono text-[10px] tracking-[0.22em] text-cyan">// PROTOCOL</span>
        </div>

        <h1 className="max-w-3xl font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
          Let agents act.
          <br />
          Make them prove it.
        </h1>

        <p className="mt-6 max-w-xl text-balance text-fd-muted-foreground sm:text-lg">
          AI agents trigger Stellar payments only after proving, in zero knowledge,
          they followed your private rules.{' '}
          <span className="text-fd-foreground">No proof, no payment.</span>
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/docs/quickstart"
            className="bg-violet px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-violet-bright"
          >
            Start building
          </Link>
          <Link
            href="/playground"
            className="border border-fd-border px-6 py-3 text-sm font-medium transition-colors hover:bg-fd-accent"
          >
            Try the playground
          </Link>
        </div>

        <a
          href={stellarExpertContractUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-10 inline-flex items-center gap-2 font-mono text-xs tracking-[0.1em] text-fd-muted-foreground transition-colors hover:text-fd-foreground"
        >
          <span className="size-1.5 rounded-full bg-cyan [animation:zen-dot_2.4s_ease-in-out_infinite]" />
          Live on Stellar testnet · Groth16 verified in {protocol.cpuBudget} CPU
        </a>
      </div>
    </section>
  );
}
