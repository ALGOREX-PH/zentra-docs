import { cn } from '@/lib/cn';
import { SCENARIOS, type Scenario } from '@/lib/scenarios';
import { HudPanel, Eyebrow } from './primitives';

function Panel({ s, index }: { s: Scenario; index: number }) {
  const denied = s.outcome !== 'settled';
  return (
    <HudPanel accent={denied ? 'violet' : 'cyan'} className="flex flex-col p-6">
      <div className="font-mono text-xs tracking-[0.12em] text-fd-muted-foreground">
        PANEL {s.id}
      </div>
      <h3 className="mt-3 font-display text-lg font-semibold">{s.title}</h3>
      <p className="mt-1 text-sm text-fd-muted-foreground">{s.subtitle}</p>

      <ul className="mt-5 space-y-2">
        {s.steps.map((step, i) => {
          const isReleased = step === 'released';
          const isBlocked = step === 'blocked';
          return (
            <li
              key={step}
              className="flex items-center gap-2.5 font-mono text-xs [animation:zen-check_.45s_ease_both]"
              style={{ animationDelay: `${index * 0.5 + i * 0.25}s` }}
            >
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  isReleased ? 'bg-cyan' : isBlocked ? 'bg-denied' : 'bg-violet-soft',
                )}
              />
              <span
                className={cn(
                  isBlocked ? 'text-denied' : isReleased ? 'text-cyan' : 'text-fd-muted-foreground',
                )}
              >
                {step}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-5 border-t border-fd-border pt-4">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 font-mono text-xs font-medium',
            denied ? 'text-denied' : 'text-cyan',
          )}
        >
          {denied ? '✗' : '✓'} {s.outcomeLabel}
        </span>
        <p className="mt-2 text-xs leading-relaxed text-fd-muted-foreground">{s.explanation}</p>
      </div>
    </HudPanel>
  );
}

export function ScenarioPanels() {
  return (
    <section className="border-b border-fd-border">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <Eyebrow accent="cyan">ZENTRA // PROOF IN THREE ACTS</Eyebrow>
        <h2 className="max-w-2xl font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          One legitimate payment. Two attacks, stopped two different ways.
        </h2>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {SCENARIOS.map((s, i) => (
            <Panel key={s.id} s={s} index={i} />
          ))}
        </div>

        <p className="mt-6 text-sm text-fd-muted-foreground">
          Panel B is stopped by the circuit; Panel C by the contract.{' '}
          <a href="/playground" className="text-fd-primary hover:underline">
            Run them in the playground →
          </a>
        </p>
      </div>
    </section>
  );
}
