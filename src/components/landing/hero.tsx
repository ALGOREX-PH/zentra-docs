import Link from 'next/link';
import { ProofEngine } from './proof-engine';

export function Hero() {
  return (
    <header className="zen-grid relative overflow-hidden border-b border-violet/20 px-7 py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 70% 60% at 70% 30%, rgba(124,58,237,0.16), transparent 70%)' }}
      />
      <div className="relative mx-auto grid max-w-6xl items-center gap-11 lg:grid-cols-2">
        <div>
          <div
            className="mb-6 inline-flex items-center gap-2.5 border border-violet/40 px-3 py-1.5"
            style={{ background: 'rgba(124,58,237,0.07)' }}
          >
            <span className="size-1.5 bg-violet" />
            <span className="font-mono text-[11px] tracking-[0.1em] text-[#c4b5fd]">
              ZK POLICY LAYER · AUTONOMOUS AGENTS
            </span>
          </div>

          <h1 className="font-display text-[42px] font-bold leading-[1.06] tracking-[-0.03em] sm:text-5xl">
            Let agents act.
            <br />
            <span className="bg-gradient-to-r from-violet-soft to-cyan bg-clip-text text-transparent">
              Make them prove it.
            </span>
          </h1>

          <p className="mt-5 max-w-[520px] text-lg leading-relaxed text-[#cbd5e1]">
            Zentra lets AI agents trigger Stellar payments only after proving, in
            zero knowledge, that they followed your private rules.
          </p>
          <p className="mt-4 font-mono text-xs tracking-[0.04em] text-muted">
            PRIVATE POLICY → PUBLIC ENFORCEMENT → VERIFIED RECEIPTS
          </p>

          <div className="mt-8 flex flex-wrap">
            <Link
              href="/docs/quickstart"
              className="inline-flex items-center gap-2.5 bg-violet px-6 py-3.5 text-sm font-semibold text-white transition-shadow hover:shadow-[0_0_28px_rgba(124,58,237,0.5)]"
            >
              Start Building <span className="font-mono text-[13px]">→</span>
            </Link>
            <Link
              href="/playground"
              className="inline-flex items-center border border-l-0 border-fd-border px-6 py-3.5 text-sm font-semibold text-[#e2e8f0] transition-colors hover:border-cyan/60 hover:text-cyan"
            >
              Playground
            </Link>
          </div>

          <p className="mt-9 font-display text-xl font-bold uppercase tracking-[0.02em]">
            No proof, no payment.
          </p>
        </div>

        <ProofEngine />
      </div>
    </header>
  );
}
