'use client';

import { useEffect, useState } from 'react';
import { HudPanel } from '@/components/landing/primitives';
import { cn } from '@/lib/cn';
import type { Scenario } from '@/lib/scenarios';

export function ScenarioPlayer({ s }: { s: Scenario }) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [reduced, setReduced] = useState(false);
  const denied = s.outcome !== 'settled';
  const finished = !playing && step >= s.steps.length && step > 0;

  useEffect(() => {
    setReduced(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  }, []);

  useEffect(() => {
    if (!playing) return;
    if (step >= s.steps.length) {
      setPlaying(false);
      return;
    }
    const id = setTimeout(() => setStep((x) => x + 1), 600);
    return () => clearTimeout(id);
  }, [playing, step, s.steps.length]);

  function run() {
    // Under reduced motion there is no staged reveal: the finished scenario —
    // every phase and its outcome — is shown at once instead.
    if (reduced) {
      setPlaying(false);
      setStep(s.steps.length);
      return;
    }
    setStep(0);
    setPlaying(true);
  }

  return (
    <HudPanel accent={denied ? 'violet' : 'cyan'} className="flex flex-col p-6">
      <div className="font-mono text-xs tracking-[0.12em] text-fd-muted-foreground">
        PANEL {s.id}
      </div>
      <h3 className="mt-3 font-display text-lg font-semibold">{s.title}</h3>
      <p className="mt-1 text-sm text-fd-muted-foreground">{s.subtitle}</p>

      <ul className="mt-5 min-h-[112px] space-y-2" aria-live="polite" aria-busy={playing}>
        {s.steps.slice(0, step).map((phase, i) => {
          const released = phase === 'released';
          const blocked = phase === 'blocked';
          return (
            <li
              key={phase}
              className="flex items-center gap-2.5 font-mono text-xs motion-safe:[animation:zen-check_.4s_ease_both]"
              style={{ animationDelay: `${i * 0.04}s` }}
            >
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  released ? 'bg-cyan' : blocked ? 'bg-denied' : 'bg-violet-soft',
                )}
              />
              <span
                className={cn(
                  blocked ? 'text-denied' : released ? 'text-cyan' : 'text-fd-muted-foreground',
                )}
              >
                {phase}
              </span>
            </li>
          );
        })}
      </ul>

      {finished && (
        <div
          role="status"
          className="border-t border-fd-border pt-4 motion-safe:[animation:zen-check_.4s_ease_both]"
        >
          <span
            className={cn(
              'inline-flex items-center gap-1.5 font-mono text-xs font-medium',
              denied ? 'text-denied' : 'text-cyan',
            )}
          >
            <span aria-hidden>{denied ? '✗' : '✓'}</span> {s.outcomeLabel}
          </span>
          <p className="mt-2 text-xs leading-relaxed text-fd-muted-foreground">{s.explanation}</p>
        </div>
      )}

      <button
        type="button"
        onClick={run}
        disabled={playing}
        className={cn(
          'mt-5 w-full border px-4 py-2 font-mono text-xs tracking-wide transition-colors',
          playing
            ? 'cursor-wait border-fd-border text-fd-muted-foreground'
            : 'border-violet/50 text-violet-soft hover:bg-violet/10',
        )}
      >
        {playing ? 'running…' : finished ? 'replay' : 'run scenario'}
      </button>
    </HudPanel>
  );
}
