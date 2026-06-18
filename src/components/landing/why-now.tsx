import { Eyebrow } from './primitives';
import { protocol } from '@/config/protocol';

const CAPS = [
  { k: 'CAP-0074', d: 'BN254 host functions — point ops and the multi-pairing check.' },
  { k: 'CAP-0075', d: 'Poseidon permutation — the same hash the circuit uses, on-chain.' },
  { k: 'CAP-80', d: 'BN254 multi-scalar multiplication to aggregate the public inputs.' },
];

export function WhyNow() {
  return (
    <section className="border-b border-fd-border">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <Eyebrow>ZENTRA // WHY NOW</Eyebrow>
        <h2 className="max-w-2xl font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          On-chain ZK verification is real and affordable on Soroban.
        </h2>
        <p className="mt-4 max-w-2xl text-fd-muted-foreground">
          Protocol 25 "X-Ray" and Protocol 26 "Yardstick" shipped the primitives a
          Groth16 verifier needs. A real proof now verifies inside the contract for
          about <span className="text-cyan">{protocol.cpuBudget}</span> of the
          per-transaction budget.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {CAPS.map((c) => (
            <div key={c.k} className="border border-fd-border bg-panel p-5">
              <div className="font-mono text-sm text-violet-soft">{c.k}</div>
              <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">{c.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
