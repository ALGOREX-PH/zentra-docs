import { Eyebrow } from './primitives';

const STEPS = [
  { n: '01', t: 'Define', d: 'Author a private policy; register only its commitment and recipient root.' },
  { n: '02', t: 'Prove', d: 'The SDK builds a Groth16 proof binding the action to the policy and on-chain state.' },
  { n: '03', t: 'Verify', d: 'The Soroban contract checks the proof, the state binding, and the nullifier.' },
  { n: '04', t: 'Settle', d: 'Funds move and a verifiable ActionReceipt is emitted.' },
];

export function HowItWorks() {
  return (
    <section className="border-b border-fd-border">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <Eyebrow>ZENTRA // THE LOOP</Eyebrow>
        <h2 className="max-w-2xl font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          From intent to settlement, in four steps.
        </h2>

        <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n} className="border border-fd-border bg-panel p-5">
              <div className="font-mono text-xs text-violet-soft">{s.n}</div>
              <div className="mt-3 font-display text-base font-semibold">{s.t}</div>
              <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">{s.d}</p>
            </li>
          ))}
        </ol>

        <a
          href="/docs/how-it-works/overview"
          className="mt-6 inline-block text-sm text-fd-primary hover:underline"
        >
          See the full flow →
        </a>
      </div>
    </section>
  );
}
