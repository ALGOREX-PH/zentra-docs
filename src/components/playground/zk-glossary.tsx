'use client';

import { useId, useState } from 'react';
import { GLOSSARY } from '@/lib/zk/education';
import { HudPanel, Eyebrow } from '@/components/landing/primitives';
import { cn } from '@/lib/cn';

export function ZkGlossary() {
  const [open, setOpen] = useState<number | null>(null);
  const uid = useId();

  return (
    <HudPanel>
      <div className="p-5 sm:p-6">
        <Eyebrow>ZK GLOSSARY · PLAIN ENGLISH</Eyebrow>
        <p className="mt-1 font-mono text-[11px] text-muted">Select a term to expand.</p>

        <ul className="mt-4 border border-fd-border divide-y divide-fd-border">
          {GLOSSARY.map((entry, i) => {
            const isOpen = open === i;
            const bodyId = `${uid}-${i}`;
            return (
              <li key={entry.term}>
                {/* The definition sits outside the button: inside it, the whole
                    paragraph would be read out as the button's name. */}
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={bodyId}
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-abyss"
                >
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
                </button>
                <p
                  id={bodyId}
                  hidden={!isOpen}
                  className="max-w-[680px] px-4 pb-3 text-[13px] leading-relaxed text-muted"
                >
                  {entry.body}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </HudPanel>
  );
}
