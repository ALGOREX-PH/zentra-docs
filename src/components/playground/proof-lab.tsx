'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { HudPanel, Eyebrow } from '@/components/landing/primitives';
import {
  ProofError,
  generateProof,
  loadExampleInput,
  type ProofResult,
  type ProofStage,
} from '@/lib/zk/prover';
import { PIPELINE, STAGE_STATUS, type PipelineStep } from '@/lib/zk/education';
import { SignalsTable } from '@/components/playground/signals-table';
import { WhatThisProves } from '@/components/playground/what-this-proves';
import { cn } from '@/lib/cn';
import { shorten } from '@/lib/ui';

/**
 * Anchoring is only reachable once a proof exists and it pulls in the Stellar
 * SDK, so it loads on demand instead of in the playground's first bundle.
 */
const ProofAnchor = dynamic(
  () => import('@/components/playground/proof-anchor').then((m) => m.ProofAnchor),
  {
    loading: () => (
      <HudPanel accent="violet">
        <p className="p-5 font-mono text-[11px] text-faint sm:p-6">Loading the on-chain anchor…</p>
      </HudPanel>
    ),
  },
);

type Phase = 'idle' | 'proving' | 'done' | 'error';
type StepState = 'pending' | 'active' | 'done' | 'failed';

/** A failure, pinned to the step it happened in. */
interface RunError {
  stage: ProofStage;
  title: string;
  message: string;
}

const STEP_CLASS: Record<StepState, string> = {
  pending: 'border-fd-border text-faint',
  active: 'border-cyan/50 text-cyan',
  done: 'border-live/40 text-live',
  failed: 'border-denied/50 text-denied',
};

/** Where a step sits relative to the phase the run has actually reached. */
function stepState(
  step: PipelineStep,
  phase: Phase,
  stage: ProofStage,
  failedAt: ProofStage | null,
): StepState {
  if (phase === 'done') return 'done';
  if (phase === 'error') {
    if (failedAt === null) return 'pending';
    if (step.stage === failedAt) return 'failed';
    return step.stage === 'circuit' ? 'done' : 'pending';
  }
  if (phase !== 'proving') return 'pending';
  if (step.stage === stage) return 'active';
  return stage === 'proving' && step.stage === 'circuit' ? 'done' : 'pending';
}

export function ProofLab({ onAnchored }: { onAnchored?: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [stage, setStage] = useState<ProofStage>('circuit');
  /** Download percent, or `null` while the total is still unknown (indeterminate). */
  const [percent, setPercent] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<ProofResult | null>(null);
  const [error, setError] = useState<RunError | null>(null);
  const run = useRef<AbortController | null>(null);

  // Tear the worker down if the user leaves mid-proof.
  useEffect(() => () => run.current?.abort(), []);

  // A real elapsed clock for the worker leg, which reports no progress of its own.
  useEffect(() => {
    if (phase !== 'proving' || stage !== 'proving') return;
    const started = performance.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(performance.now() - started), 200);
    return () => clearInterval(id);
  }, [phase, stage]);

  async function prove() {
    run.current?.abort();
    const controller = new AbortController();
    run.current = controller;
    setPhase('proving');
    setStage('circuit');
    setPercent(null);
    setElapsed(0);
    setResult(null);
    setError(null);
    try {
      const input = await loadExampleInput();
      const res = await generateProof(input, {
        signal: controller.signal,
        // Same-value updates bail out in React, so per-chunk calls are cheap.
        onProgress: (progress) => {
          setStage(progress.stage);
          if (progress.stage === 'circuit' && progress.total > 0) {
            // Clamped and monotonic: a shifting total (or an over-reporting
            // stream) must never show >100% or walk the bar backwards. While
            // the total is unreported the bar simply stays indeterminate.
            const next = Math.min(100, Math.round((progress.loaded / progress.total) * 100));
            setPercent((prev) => (prev === null ? next : Math.max(prev, next)));
          }
        },
      });
      if (controller.signal.aborted) return;
      // A proof that fails its own verification is a failure, not a result:
      // it must never reach the signals table or the on-chain anchor.
      if (!res.verified) {
        setError({
          stage: 'proving',
          title: 'Proof did not verify',
          message:
            'The proof was produced but failed verification against the verification key, so it was discarded.',
        });
        setPhase('error');
        return;
      }
      setResult(res);
      setPhase('done');
    } catch (err) {
      if (controller.signal.aborted) return;
      const failedAt = err instanceof ProofError ? err.stage : 'proving';
      setError({
        stage: failedAt,
        title: failedAt === 'circuit' ? 'Circuit could not be loaded' : 'Proving failed',
        message: err instanceof Error ? err.message : 'Proof generation failed.',
      });
      setPhase('error');
    }
  }

  /**
   * Abandon the in-flight run: the AbortController tears the worker down (see
   * `runWorker`), and the lab returns to a clean idle state, ready to re-run.
   */
  function cancel() {
    run.current?.abort();
    run.current = null;
    setPhase('idle');
    setStage('circuit');
    setPercent(null);
    setElapsed(0);
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
            This runs the actual Zentra payment-policy circuit (Circom + snarkjs, Groth16 over
            BN254) entirely in your browser. The proof shows an agent&apos;s action obeys a private
            policy — without revealing the policy.
          </p>

          {proving ? (
            // While a run is live the primary control becomes its escape hatch,
            // so a slow or hung prove never leaves the user with a dead button.
            <button
              type="button"
              onClick={cancel}
              className="mt-5 inline-flex items-center gap-2 border border-denied/50 bg-denied/[0.06] px-5 py-3 font-mono text-xs uppercase tracking-[0.1em] text-denied transition-colors hover:bg-denied/15"
            >
              <span aria-hidden className="size-1.5 bg-denied" />
              Cancel proving
            </button>
          ) : (
            <button
              type="button"
              onClick={prove}
              className="mt-5 inline-flex items-center gap-2 bg-violet px-5 py-3 font-mono text-xs uppercase tracking-[0.1em] text-white transition-colors hover:bg-[#8b5cf6]"
            >
              <span aria-hidden className="size-1.5 bg-cyan" />
              {phase === 'error'
                ? 'Try again'
                : phase === 'done'
                  ? 'Generate another proof'
                  : 'Generate real proof'}
            </button>
          )}

          {phase === 'idle' ? (
            <p className="mt-4 font-mono text-[11px] text-faint">
              No proof yet — nothing is sent to a server, the circuit runs in this tab.
            </p>
          ) : null}

          <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PIPELINE.map((step, i) => {
              const state = stepState(step, phase, stage, error?.stage ?? null);
              return (
                <li
                  key={step.label}
                  aria-current={state === 'active' ? 'step' : undefined}
                  className={cn(
                    'relative overflow-hidden border px-3 py-3 font-mono text-[11px] tracking-[0.06em] transition-colors',
                    STEP_CLASS[state],
                  )}
                >
                  <span className="text-muted">{String(i + 1).padStart(2, '0')}</span> {step.label}
                  {state === 'active' ? (
                    <span
                      aria-hidden
                      className="absolute inset-x-0 bottom-0 h-px animate-pulse bg-cyan"
                    />
                  ) : null}
                </li>
              );
            })}
          </ol>

          {proving ? (
            <div className="mt-4">
              <div className="flex items-baseline justify-between gap-3">
                <p role="status" className="font-mono text-[11px] text-muted">
                  {STAGE_STATUS[stage]}
                </p>
                <span aria-hidden className="shrink-0 font-mono text-[11px] text-faint">
                  {stage === 'circuit'
                    ? percent === null
                      ? '…'
                      : `${percent}%`
                    : `${(elapsed / 1000).toFixed(1)}s`}
                </span>
              </div>
              {stage === 'circuit' ? (
                // Omitting aria-valuenow while percent is null is the ARIA
                // idiom for an indeterminate progressbar — it matches the
                // visible "…" instead of announcing a made-up number.
                <div
                  role="progressbar"
                  aria-label="Circuit download"
                  aria-valuenow={percent ?? undefined}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className={cn(
                    'mt-2 h-px w-full bg-fd-border',
                    percent === null && 'motion-safe:animate-pulse',
                  )}
                >
                  <span
                    className="block h-full bg-cyan transition-[width] duration-200"
                    style={{ width: `${percent ?? 0}%` }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div role="alert" className="mt-4 border border-denied/40 bg-denied/[0.06] px-4 py-3">
              <h3 className="font-mono text-xs uppercase tracking-[0.1em] text-denied">
                {error.title}
              </h3>
              <p className="mt-1 text-[13px] text-muted">{error.message}</p>
              <p className="mt-1.5 font-mono text-[11px] text-faint">
                Nothing left this tab, and nothing was anchored — press{' '}
                <span className="text-muted">Try again</span> to re-run it.
              </p>
            </div>
          ) : null}
        </div>
      </HudPanel>

      {result ? (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            <HudPanel accent="cyan">
              <div className="p-5 sm:p-6">
                <Eyebrow accent="cyan">THE PROOF · π</Eyebrow>
                <dl className="mt-3 space-y-2 font-mono text-[11px]">
                  <Point label="π_a (G1)" values={result.proof.pi_a} />
                  <Point label="π_b (G2)" values={result.proof.pi_b.flat()} />
                  <Point label="π_c (G1)" values={result.proof.pi_c} />
                </dl>
                <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border border-live/40 bg-live/[0.06] px-3 py-2 font-mono text-xs text-live">
                  <svg width="14" height="14" viewBox="0 0 15 15" aria-hidden>
                    <polyline
                      points="2,8 6,12 13,3"
                      fill="none"
                      stroke="#22c55e"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Verified locally · valid
                  <span className="ml-auto text-faint">
                    prove {result.proveMs}ms · verify {result.verifyMs}ms
                  </span>
                </div>
              </div>
            </HudPanel>

            <SignalsTable publicSignals={result.publicSignals} />
          </div>
          <WhatThisProves />
          <ProofAnchor result={result} onAnchored={onAnchored} />
        </>
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
            {shorten(v, 12, 8)}
          </div>
        ))}
      </dd>
    </div>
  );
}
