'use client';

import { Fragment, useId, useState } from 'react';
import { Eyebrow, HudPanel } from '@/components/landing/primitives';
import { cn } from '@/lib/cn';
import { shorten } from '@/lib/ui';
import { SIGNALS, type SignalKind } from '@/lib/zk/education';

/** Rendered in its own column, and again beside the label once that column is
 *  dropped for narrow screens. */
function KindBadge({ kind, className }: { kind: SignalKind; className?: string }) {
  return kind === 'hash' ? (
    <span className={cn('border border-cyan/40 px-1 font-mono text-[9px] text-cyan', className)}>
      hash
    </span>
  ) : (
    <span
      className={cn(
        'border border-violet/40 px-1 font-mono text-[9px] text-violet-soft',
        className,
      )}
    >
      value
    </span>
  );
}

export function SignalsTable({ publicSignals }: { publicSignals: string[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const uid = useId();

  return (
    <HudPanel>
      <div className="p-5 sm:p-6">
        <Eyebrow>PUBLIC SIGNALS · WHAT THE PROOF REVEALS</Eyebrow>
        <p className="mt-1 font-mono text-[11px] text-muted">
          Select any signal to learn what it means.
        </p>

        <table className="mt-3 w-full border border-fd-border text-left">
          <caption className="sr-only">
            The public signals this proof reveals, in the order the circuit emits them. Each row
            expands to explain what that signal means.
          </caption>
          <thead>
            <tr className="border-b border-fd-border font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
              <th scope="col" className="hidden px-4 py-2 font-normal sm:table-cell">
                #
              </th>
              <th scope="col" className="px-2 py-2 font-normal sm:px-4">
                Signal
              </th>
              <th scope="col" className="hidden px-4 py-2 font-normal sm:table-cell">
                Kind
              </th>
              <th scope="col" className="px-2 py-2 text-right font-normal sm:px-4">
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {publicSignals.map((value, i) => {
              const info = SIGNALS[i];
              const label = info ? info.label : `Signal ${i}`;
              const kind = info ? info.kind : 'value';
              const isOpen = open === i;
              const descId = `${uid}-${i}`;

              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: public signals are positional by circuit definition; SIGNALS[i] is read off the same index.
                <Fragment key={i}>
                  <tr className="border-t border-fd-border align-top">
                    <td className="hidden px-4 py-2.5 font-mono text-[11px] text-faint sm:table-cell">
                      {String(i).padStart(2, '0')}
                    </td>
                    <th scope="row" className="p-0 font-normal">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-controls={descId}
                        onClick={() => setOpen(isOpen ? null : i)}
                        className="flex w-full items-center gap-2 px-2 py-2.5 text-left text-sm text-text transition-colors hover:bg-abyss sm:px-4"
                      >
                        {label}
                        <KindBadge kind={kind} className="sm:hidden" />
                        <span
                          aria-hidden
                          className={cn(
                            'ml-auto font-mono text-[11px] text-faint transition-transform',
                            isOpen ? 'rotate-180 text-violet-soft' : '',
                          )}
                        >
                          ▾
                        </span>
                      </button>
                    </th>
                    <td className="hidden px-4 py-2.5 sm:table-cell">
                      <KindBadge kind={kind} />
                    </td>
                    <td
                      className={cn(
                        'px-2 py-2.5 text-right font-mono text-[11px] sm:px-4',
                        kind === 'hash' ? 'text-violet-soft' : 'text-text',
                      )}
                    >
                      {shorten(value, 8, 4)}
                    </td>
                  </tr>
                  <tr id={descId} hidden={!isOpen}>
                    <td colSpan={4} className="px-2 pb-3 text-[12px] text-muted sm:px-4">
                      {info ? info.desc : 'Raw public signal emitted by the proof.'}
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </HudPanel>
  );
}
