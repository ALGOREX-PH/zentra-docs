'use client';

import { useState } from 'react';
import { SIGNALS } from '@/lib/zk/education';
import { HudPanel, Eyebrow } from '@/components/landing/primitives';
import { cn } from '@/lib/cn';

function shorten(v: string): string {
  return v.length > 14 ? `${v.slice(0, 8)}…${v.slice(-4)}` : v;
}

export function SignalsTable({ publicSignals }: { publicSignals: string[] }) {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <HudPanel>
      <div className="p-5 sm:p-6">
        <Eyebrow>PUBLIC SIGNALS · WHAT THE PROOF REVEALS</Eyebrow>
        <p className="mt-1 font-mono text-[11px] text-muted">Tap any row to learn what it means.</p>

        <ul className="mt-3 border border-fd-border divide-y divide-fd-border">
          {publicSignals.map((value, i) => {
            const info = SIGNALS[i];
            const label = info ? info.label : `Signal ${i}`;
            const kind = info ? info.kind : 'value';
            const isOpen = open === i;

            return (
              <li key={i}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="w-full text-left px-4 py-2.5 hover:bg-abyss transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-faint">
                        [{String(i).padStart(2, '0')}]
                      </span>
                      <span className="text-text text-sm">{label}</span>
                      {kind === 'hash' ? (
                        <span className="border border-cyan/40 text-cyan px-1 text-[9px] font-mono">hash</span>
                      ) : (
                        <span className="border border-violet/40 text-violet-soft px-1 text-[9px] font-mono">value</span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          'font-mono text-[11px]',
                          kind === 'hash' ? 'text-violet-soft' : 'text-text',
                        )}
                      >
                        {shorten(value)}
                      </span>
                      <span
                        aria-hidden
                        className={cn(
                          'font-mono text-[11px] text-faint transition-transform',
                          isOpen ? 'rotate-180 text-violet-soft' : '',
                        )}
                      >
                        ▾
                      </span>
                    </span>
                  </div>

                  {isOpen ? (
                    <p className="mt-1.5 text-[12px] text-muted">{info ? info.desc : 'Raw public signal emitted by the proof.'}</p>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </HudPanel>
  );
}
