'use client';

import { useState } from 'react';
import { GLOSSARY } from '@/lib/zk/education';
import { HudPanel, Eyebrow } from '@/components/landing/primitives';
import { cn } from '@/lib/cn';

export function ZkGlossary() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <HudPanel>
      <div className="p-5 sm:p-6">
        <Eyebrow>ZK GLOSSARY · PLAIN ENGLISH</Eyebrow>
        <p className="mt-1 font-mono text-[11px] text-muted">Tap a term to expand.</p>

        <ul className="mt-4 border border-fd-border divide-y divide-fd-border">
          {GLOSSARY.map((entry, i) => {
            const isOpen = open === i;
            return (
              <li key={entry.term}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="w-full text-left px-4 py-3 hover:bg-abyss transition-colors"
                >
                  <span className="flex items-center justify-between">
                    <span className="font-mono text-sm text-text">{entry.term}</span>
                    <span
                      aria-hidden
                      className={cn(
                        'font-mono text-xs text-faint transition-transform',
                        isOpen && 'rotate-180',
                      )}
                    >
                      ▾
                    </span>
                  </span>
                  {isOpen ? (
                    <span className="mt-2 block max-w-[680px] text-[13px] leading-relaxed text-muted">
                      {entry.body}
                    </span>
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
