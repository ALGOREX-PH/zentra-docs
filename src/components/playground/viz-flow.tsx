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
    <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center md:gap-0">
      {STAGES.map((s, i) => (
        <Fragment key={s.title}>
          <div
            className={cn(
              'relative border bg-panel px-4 py-5 text-center md:flex-1',
              border[s.accent],
            )}
          >
            <div className="font-display text-2xl leading-none">{s.glyph}</div>
            <div className={cn('mt-2 font-mono text-[11px] uppercase tracking-[0.1em]', text[s.accent])}>
              {s.title}
            </div>
            <div className="mt-1 text-[11px] leading-snug text-faint">{s.sub}</div>
          </div>

          {i < STAGES.length - 1 ? (
            <div
              aria-hidden
              className="relative mx-auto flex h-5 w-px items-center justify-center overflow-hidden md:h-px md:w-12"
            >
              <span className="absolute inset-0 bg-fd-border" />
              <span className="absolute left-0 hidden size-1.5 rounded-full bg-cyan motion-safe:md:block motion-safe:md:[animation:zen-flow_1.8s_linear_infinite]" />
            </div>
          ) : null}
        </Fragment>
      ))}
    </div>
  );
}
