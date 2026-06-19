import type { Metadata } from 'next';
import { cn } from '@/lib/cn';
import { Eyebrow } from '@/components/landing/primitives';
import { Footer } from '@/components/landing/footer';

export const metadata: Metadata = {
  title: 'Roadmap',
  description: 'From v0.1 proof-gated payments to a cross-chain agent trust stack.',
};

const STAGES = [
  {
    v: 'v0.1',
    t: 'Proof-gated payments',
    status: 'Live on testnet',
    now: true,
    items: [
      'State-bound Groth16 proofs',
      'On-chain BN254 + Poseidon verification',
      'Verifiable Action Receipts',
    ],
  },
  {
    v: 'v0.2',
    t: 'Policy Runtime',
    status: 'Planned',
    items: ['Composable, versioned, revocable policies', 'A TypeScript policy DSL', 'Policy templates'],
  },
  {
    v: 'v0.3',
    t: 'Beyond payments',
    status: 'Planned',
    items: ['Contract calls and treasury actions', 'API payments', 'Workflow approvals'],
  },
  {
    v: 'v0.4',
    t: 'Reputation from verified actions',
    status: 'Planned',
    items: ['ERC-8004 / stellar8004 connector', 'Receipts → portable reputation'],
  },
  {
    v: 'v0.5',
    t: 'Scoped permissions',
    status: 'Planned',
    items: ['ERC-7715-style scoped grants'],
  },
  {
    v: 'v1.0',
    t: 'Cross-chain agent trust stack',
    status: 'Planned',
    items: ['Identity + permission + compliance + settlement + reputation, in one place'],
  },
];

export default function RoadmapPage() {
  return (
    <>
      <section className="zen-grid border-b border-fd-border">
        <div className="mx-auto max-w-4xl px-5 py-14 sm:px-6 sm:py-20">
          <Eyebrow accent="cyan">ZENTRA // ROADMAP</Eyebrow>
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            From a proof-gated payment to a trust stack.
          </h1>
          <p className="mt-4 max-w-2xl text-fd-muted-foreground">
            v0.1 is live on Stellar testnet today. Everything below it is planned —
            shown here so you can see where the protocol is headed, not what it
            already does.
          </p>

          <ol className="mt-12 space-y-px border border-fd-border bg-fd-border">
            {STAGES.map((s) => (
              <li key={s.v} className="relative bg-panel p-6">
                {s.now && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-cyan" />}
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-sm text-violet-soft">{s.v}</span>
                  <h2 className="font-display text-lg font-semibold">{s.t}</h2>
                  <span
                    className={cn(
                      'ml-auto font-mono text-[11px] tracking-wide',
                      s.now ? 'text-cyan' : 'text-fd-muted-foreground',
                    )}
                  >
                    {s.now ? '◍ ' : ''}
                    {s.status}
                  </span>
                </div>
                <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-fd-muted-foreground">
                  {s.items.map((it) => (
                    <li key={it}>· {it}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>

          <p className="mt-8 text-sm text-fd-muted-foreground">
            Also under research: Noir / RISC Zero proving backends, recursive proof
            aggregation, and multi-asset settlement.
          </p>
        </div>
      </section>
      <Footer />
    </>
  );
}
