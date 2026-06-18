import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** A bordered panel with HUD corner brackets — the recurring "proof gate" frame. */
export function HudPanel({
  children,
  className,
  accent = 'violet',
}: {
  children: ReactNode;
  className?: string;
  accent?: 'violet' | 'cyan';
}) {
  const edge = accent === 'cyan' ? 'border-cyan/40' : 'border-violet/40';
  const corner = accent === 'cyan' ? 'border-cyan' : 'border-violet';
  return (
    <div className={cn('relative border bg-panel', edge, className)}>
      <span
        aria-hidden
        className={cn('pointer-events-none absolute -left-px -top-px h-3 w-3 border-l-2 border-t-2', corner)}
      />
      <span
        aria-hidden
        className={cn('pointer-events-none absolute -bottom-px -right-px h-3 w-3 border-b-2 border-r-2', corner)}
      />
      {children}
    </div>
  );
}

/** A mono section label with the `//` motif and a trailing hairline. */
export function Eyebrow({
  children,
  accent = 'violet',
}: {
  children: ReactNode;
  accent?: 'violet' | 'cyan';
}) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <span
        className={cn(
          'font-mono text-xs tracking-[0.14em]',
          accent === 'cyan' ? 'text-cyan' : 'text-violet-soft',
        )}
      >
        {children}
      </span>
      <span className={cn('h-px flex-1', accent === 'cyan' ? 'bg-cyan/25' : 'bg-violet/25')} />
    </div>
  );
}
