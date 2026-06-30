'use client';

import { useEffect, useRef, useState } from 'react';
import { HudPanel, Eyebrow } from '@/components/landing/primitives';
import { generateProof, loadExampleInput, type ProofResult } from '@/lib/zk/prover';
import { cn } from '@/lib/cn';

type Phase = 'idle' | 'proving' | 'done' | 'error';

const STAGES = ['Load circuit', 'Compute witness', 'Generate proof', 'Verify'] as const;

function short(value: string, head = 10, tail = 6) {
  if (value.length <= head + tail) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function ProofLab() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [stage, setStage] = useState(0);
  const [result, setResult] = useState<ProofResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  async function run() {
    setPhase('proving');
    setResult(null);
    setError(null);
    setStage(0);
    // Advance the stage indicator while the worker proves (real work, no faked result).
    timer.current = setInterval(
      () => setStage((s) => Math.min(s + 1, STAGES.length - 2)),
      900,
    );
    try {
      const input = await loadExampleInput();
      const res = await generateProof(input);
      if (timer.current) clearInterval(timer.current);
      setStage(STAGES.length - 1);
      setResult(res);
      setPhase('done');
    } catch (err) {
      if (timer.current) clearInterval(timer.current);
      setError(err instanceof Error ? err.message : 'Proof generation failed.');
      setPhase('error');
    }
  }

  const proving = phase === 'proving';

  return (
    <div className="space-y-5">
      <HudPanel>
        <div className="p-5 sm:p-6">
          <Eyebrow>// PROOF LAB</Eyebrow>
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
            Generate a real Groth16 proof
          </h2>
          <p className="mt-2 max-w-[640px] text-sm text-muted">
            This runs the actual Zentra payment-policy circuit (Circom + snarkjs,
            Groth16 over BN254) entirely in your browser. The proof shows an
            agent&apos;s action obeys a private policy — without revealing the policy.
          </p>

          <button
            type="button"
            onClick={run}
            disabled={proving}
            className="mt-5 inline-flex items-center gap-2 bg-violet px-5 py-3 font-mono text-xs uppercase tracking-[0.1em] text-white transition-colors hover:bg-[#8b5cf6] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span aria-hidden className="size-1.5 bg-cyan" />
            {proving ? 'Proving…' : 'Generate real proof'}
          </button>

          <ol className="mt-6 grid gap-3 sm:grid-cols-4">
            {STAGES.map((label, i) => {
              const active = proving && i === stage;
              const complete = phase === 'done' || (proving && i < stage);
              return (
                <li
                  key={label}
                  className={cn(
                    'relative overflow-hidden border px-3 py-3 font-mono text-[11px] tracking-[0.06em] transition-colors',
                    complete
                      ? 'border-live/40 text-live'
                      : active
                        ? 'border-cyan/50 text-cyan'
                        : 'border-fd-border text-faint',
                  )}
                >
                  <span className="text-muted">{String(i + 1).padStart(2, '0')}</span>{' '}
                  {label}
                  {active ? (
                    <span className="absolute inset-x-0 bottom-0 h-px animate-pulse bg-cyan" />
                  ) : null}
                </li>
              );
            })}
          </ol>

          {error ? (
            <p className="mt-4 font-mono text-xs text-denied">{error}</p>
          ) : null}
        </div>
      </HudPanel>

      {result ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <HudPanel accent="cyan">
            <div className="p-5 sm:p-6">
              <Eyebrow accent="cyan">THE PROOF · π</Eyebrow>
              <dl className="mt-3 space-y-2 font-mono text-[11px]">
                <Point label="π_a (G1)" values={result.proof.pi_a} />
                <Point label="π_b (G2)" values={result.proof.pi_b.flat()} />
                <Point label="π_c (G1)" values={result.proof.pi_c} />
              </dl>
              <div className="mt-4 flex items-center gap-2 border border-live/40 bg-live/[0.06] px-3 py-2 font-mono text-xs text-live">
                <svg width="14" height="14" viewBox="0 0 15 15" aria-hidden>
                  <polyline points="2,8 6,12 13,3" fill="none" stroke="#22c55e" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Verified locally · {result.verified ? 'valid' : 'INVALID'}
                <span className="ml-auto text-faint">
                  prove {result.proveMs}ms · verify {result.verifyMs}ms
                </span>
              </div>
            </div>
          </HudPanel>

          <HudPanel>
            <div className="p-5 sm:p-6">
              <Eyebrow>PUBLIC SIGNALS · {result.publicSignals.length}</Eyebrow>
              <ul className="mt-3 space-y-1.5 font-mono text-[11px] text-muted">
                {result.publicSignals.map((sig, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-faint">[{String(i).padStart(2, '0')}]</span>
                    <span className="break-all text-violet-soft">{short(sig, 14, 8)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </HudPanel>
        </div>
      ) : null}
    </div>
  );
}

function Point({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <dt className="text-faint">{label}</dt>
      <dd className="mt-0.5 space-y-0.5">
        {values.map((v, i) => (
          <div key={i} className="break-all text-violet-soft">
            {short(v, 12, 8)}
          </div>
        ))}
      </dd>
    </div>
  );
}
