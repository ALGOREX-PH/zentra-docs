import { Fragment } from 'react';
import { cn } from '@/lib/cn';

type Accent = 'violet' | 'cyan' | 'live';

interface Stage {
  glyph: string;
  title: string;
  sub: string;
  accent: Accent;
}

const STAGES: Stage[] = [
  { glyph: '🔒 👁', title: 'Inputs', sub: 'private rules + public values', accent: 'violet' },
  { glyph: '⚙', title: 'Circuit', sub: '~30k constraints, in your browser', accent: 'cyan' },
  { glyph: 'π', title: 'Proof', sub: 'just three curve points', accent: 'violet' },
  { glyph: '✓', title: 'Verify', sub: 'in milliseconds', accent: 'live' },
];

const border: Record<Accent, string> = {
  violet: 'border-violet/40',
  cyan: 'border-cyan/40',
  live: 'border-live/40',
};
const text: Record<Accent, string> = {
  violet: 'text-violet-soft',
  cyan: 'text-cyan',
  live: 'text-live',
};

/** The proof pipeline as an animated flow: inputs → circuit → proof → verify. */
export function VizFlow() {
  return (
    <ol className="flex flex-col items-stretch gap-2 md:flex-row md:items-center md:gap-0">
      {STAGES.map((s, i) => (
        <Fragment key={s.title}>
          <li
            className={cn(
              'relative border bg-panel px-4 py-5 text-center md:flex-1',
              border[s.accent],
            )}
          >
            <span aria-hidden className="block font-display text-2xl leading-none">
              {s.glyph}
            </span>
            <div
              className={cn(
                'mt-2 font-mono text-[11px] uppercase tracking-[0.1em]',
                text[s.accent],
              )}
            >
              {s.title}
            </div>
            <div className="mt-1 text-[11px] leading-snug text-faint">{s.sub}</div>
          </li>

          {i < STAGES.length - 1 ? (
            <li aria-hidden className="mx-auto flex items-center justify-center md:w-12">
              {/* Motion allowed: a pulse travels the connector, showing the direction. */}
              <span className="relative hidden h-5 w-px overflow-hidden motion-safe:block md:h-px md:w-12">
                <span className="absolute inset-0 bg-fd-border" />
                <span className="absolute left-0 hidden size-1.5 rounded-full bg-cyan md:block md:[animation:zen-flow_1.8s_linear_infinite]" />
              </span>
              {/* Motion reduced: the same direction, stated once and left alone. */}
              <span className="hidden font-mono text-sm leading-none text-faint motion-reduce:block">
                <span className="md:hidden">↓</span>
                <span className="hidden md:inline">→</span>
              </span>
            </li>
          ) : null}
        </Fragment>
      ))}
    </ol>
  );
}
