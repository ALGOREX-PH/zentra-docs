import { PROVES, PRIVATE_INPUTS } from '@/lib/zk/education';
import { HudPanel, Eyebrow } from '@/components/landing/primitives';

/**
 * After a proof is generated, explains in plain language what it guarantees and
 * what stays secret — the "aha" moment for beginners.
 */
export function WhatThisProves() {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <HudPanel accent="cyan">
        <div className="p-5 sm:p-6">
          <Eyebrow accent="cyan">WHAT THIS PROOF GUARANTEES</Eyebrow>
          <ul className="mt-3 space-y-2">
            {PROVES.map((sentence) => (
              <li key={sentence} className="flex gap-2.5 text-sm text-muted">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 15 15"
                  className="shrink-0 mt-0.5"
                  aria-hidden
                >
                  <polyline
                    points="2,8 6,12 13,3"
                    fill="none"
                    stroke="#22c55e"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {sentence}
              </li>
            ))}
          </ul>
        </div>
      </HudPanel>

      <HudPanel accent="violet">
        <div className="p-5 sm:p-6">
          <Eyebrow>WHAT STAYS SECRET</Eyebrow>
          <p className="mt-1 font-mono text-[11px] text-muted">
            Never leaves your browser. Never appears in the proof.
          </p>
          <ul className="mt-3 space-y-2.5">
            {PRIVATE_INPUTS.map((input) => (
              <li key={input.label}>
                <span className="font-mono text-xs text-violet-soft">
                  <span aria-hidden>🔒</span> {input.label}
                </span>
                <span className="block text-[12px] text-faint">{input.desc}</span>
              </li>
            ))}
          </ul>
        </div>
      </HudPanel>
    </div>
  );
}
