import type { ReactNode, Ref } from 'react';
import { cn } from '@/lib/cn';

/** A bordered panel with HUD corner brackets — the recurring "proof gate" frame. */
export function HudPanel({
  children,
  className,
  accent = 'violet',
  corners = 2,
  ref,
}: {
  children: ReactNode;
  className?: string;
  accent?: 'violet' | 'cyan';
  /** Bracket count: the default diagonal pair, or the full four-corner clamp. */
  corners?: 2 | 4;
  ref?: Ref<HTMLDivElement>;
}) {
  const edge = accent === 'cyan' ? 'border-cyan/40' : 'border-violet/40';
  const corner = accent === 'cyan' ? 'border-cyan' : 'border-violet';
  // The four-corner clamp is drawn slightly larger — it matches the inline
  // clusters it replaced pixel for pixel.
  const size = corners === 4 ? 'h-3.5 w-3.5' : 'h-3 w-3';
  return (
    <div ref={ref} className={cn('relative border bg-panel', edge, className)}>
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute -left-px -top-px border-l-2 border-t-2',
          size,
          corner,
        )}
      />
      {corners === 4 ? (
        <>
          <span
            aria-hidden
            className={cn(
              'pointer-events-none absolute -right-px -top-px border-r-2 border-t-2',
              size,
              corner,
            )}
          />
          <span
            aria-hidden
            className={cn(
              'pointer-events-none absolute -bottom-px -left-px border-b-2 border-l-2',
              size,
              corner,
            )}
          />
        </>
      ) : null}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute -bottom-px -right-px border-b-2 border-r-2',
          size,
          corner,
        )}
      />
      {children}
    </div>
  );
}

/** A mono section label with the `//` motif and a trailing hairline. */
export function Eyebrow({
  children,
  accent = 'violet',
  index,
  className,
}: {
  children: ReactNode;
  accent?: 'violet' | 'cyan';
  /** Two-digit section number, rendered as the recurring `[ 01 ]` stamp. */
  index?: string;
  className?: string;
}) {
  return (
    <div className={cn('mb-5 flex items-center gap-3', className)}>
      <span
        className={cn(
          'font-mono text-xs tracking-[0.14em]',
          accent === 'cyan' ? 'text-cyan' : 'text-violet-soft',
        )}
      >
        {index ? `[ ${index} ] ` : null}
        {children}
      </span>
      <span className={cn('h-px flex-1', accent === 'cyan' ? 'bg-cyan/25' : 'bg-violet/25')} />
    </div>
  );
}
