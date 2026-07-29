'use client';

import { Fragment, useId, useState } from 'react';
import { SIGNALS } from '@/lib/zk/education';
import { HudPanel, Eyebrow } from '@/components/landing/primitives';
import { cn } from '@/lib/cn';

function shorten(v: string): string {
  return v.length > 14 ? `${v.slice(0, 8)}…${v.slice(-4)}` : v;
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
            The public signals this proof reveals, in the order the circuit emits
            them. Each row expands to explain what that signal means.
          </caption>
          <thead>
            <tr className="border-b border-fd-border font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
              <th scope="col" className="px-4 py-2 font-normal">
                #
              </th>
              <th scope="col" className="px-4 py-2 font-normal">
                Signal
              </th>
              <th scope="col" className="px-4 py-2 font-normal">
                Kind
              </th>
              <th scope="col" className="px-4 py-2 text-right font-normal">
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
                <Fragment key={i}>
                  <tr className="border-t border-fd-border align-top">
                    <td className="px-4 py-2.5 font-mono text-[11px] text-faint">
                      {String(i).padStart(2, '0')}
                    </td>
                    <th scope="row" className="p-0 font-normal">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-controls={descId}
                        onClick={() => setOpen(isOpen ? null : i)}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-text transition-colors hover:bg-abyss"
                      >
                        {label}
                        <span
                          aria-hidden
                          className={cn(
                            'font-mono text-[11px] text-faint transition-transform',
                            isOpen ? 'rotate-180 text-violet-soft' : '',
                          )}
                        >
                          ▾
                        </span>
                      </button>
                    </th>
                    <td className="px-4 py-2.5">
                      {kind === 'hash' ? (
                        <span className="border border-cyan/40 px-1 font-mono text-[9px] text-cyan">
                          hash
                        </span>
                      ) : (
                        <span className="border border-violet/40 px-1 font-mono text-[9px] text-violet-soft">
                          value
                        </span>
                      )}
                    </td>
                    <td
                      className={cn(
                        'px-4 py-2.5 text-right font-mono text-[11px]',
                        kind === 'hash' ? 'text-violet-soft' : 'text-text',
                      )}
                    >
                      {shorten(value)}
                    </td>
                  </tr>
                  <tr id={descId} hidden={!isOpen}>
                    <td colSpan={4} className="px-4 pb-3 text-[12px] text-muted">
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
