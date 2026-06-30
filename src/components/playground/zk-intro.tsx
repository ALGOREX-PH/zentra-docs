import { HudPanel, Eyebrow } from '@/components/landing/primitives';
import { cn } from '@/lib/cn';

const STEPS = [
  {
    label: '🔒 1 · PRIVATE',
    labelClass: 'text-violet-soft',
    description: 'Your secret rules + inputs stay in your browser.',
  },
  {
    label: '◆ 2 · PROVE',
    labelClass: 'text-cyan',
    description: 'A tiny Groth16 proof is generated from them.',
  },
  {
    label: '👁 3 · PUBLIC',
    labelClass: 'text-live',
    description: 'Only the proof + a few public values are shared — and verify in milliseconds.',
  },
];

export function ZkIntro() {
  return (
    <HudPanel accent="cyan">
      <div className="p-5 sm:p-7">
        <Eyebrow accent="cyan">NEW TO ZK? START HERE</Eyebrow>
        <h2 className="font-display text-xl font-bold tracking-tight sm:text-2xl">
          What is a zero-knowledge proof?
        </h2>
        <p className="mt-3 max-w-[680px] text-sm text-muted sm:text-base">
          It lets you prove a statement is true while revealing nothing else. Zentra uses it so an
          AI agent can prove a payment follows your private rules — the spending limits and approved
          vendors stay secret, but anyone can check the agent obeyed them.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.label} className="border border-fd-border bg-abyss p-4">
              <span
                className={cn(
                  'font-mono text-[10px] uppercase tracking-[0.12em]',
                  step.labelClass,
                )}
              >
                {step.label}
              </span>
              <p className="mt-1 text-sm text-muted">{step.description}</p>
            </div>
          ))}
        </div>
        <p className="mt-5 font-mono text-[11px] text-faint">
          Below, generate a real one and inspect exactly what it reveals — and what it doesn&apos;t.
        </p>
      </div>
    </HudPanel>
  );
}
