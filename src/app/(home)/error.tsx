'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Eyebrow, HudPanel } from '@/components/landing/primitives';

/**
 * Segment error boundary for every route under `(home)` — the landing page,
 * /app, /board, /metrics, /playground and /roadmap.
 *
 * Next renders this in place of the failing page whenever a render, effect or
 * data read throws below this segment. The `(home)` layout (nav + footer) is
 * still mounted, so this returns page content only. `error.message` is never
 * shown because it can leak internals; `error.digest` is the safe, stable
 * reference a user can quote in a bug report.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="zen-grid flex min-h-[70vh] items-center px-5 py-16 sm:px-7 sm:py-24">
      <div className="mx-auto w-full max-w-[720px]">
        <HudPanel className="px-6 py-8 sm:px-10 sm:py-11">
          <Eyebrow>// ZENTRA · RUNTIME FAULT</Eyebrow>

          <div role="alert">
            <h1 className="font-display text-3xl font-bold tracking-[-0.025em] sm:text-[40px]">
              Something broke
            </h1>
            <p className="mt-3.5 max-w-[520px] text-[15px] leading-relaxed text-muted sm:text-base">
              This part of the app failed to render — nothing was signed, sent or
              settled on-chain.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-2.5 bg-violet px-6 py-3.5 text-sm font-semibold text-white transition-shadow hover:shadow-[0_0_28px_rgba(124,58,237,0.5)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
            >
              Try again{' '}
              <span aria-hidden className="font-mono text-[13px]">
                ↻
              </span>
            </button>
            <Link
              href="/"
              className="inline-flex items-center border border-fd-border px-6 py-3.5 text-sm font-semibold text-[#e2e8f0] transition-colors hover:border-cyan/60 hover:text-cyan focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
            >
              Back to home
            </Link>
          </div>

          {error.digest ? (
            <div className="mt-8 border-t border-violet/20 pt-5">
              <p className="font-mono text-xs leading-relaxed text-faint">
                <span className="tracking-[0.14em]">ERROR DIGEST</span>{' '}
                <code className="text-violet-soft">{error.digest}</code>
              </p>
              <p className="mt-1.5 font-mono text-xs leading-relaxed text-faint">
                Quote this reference in a bug report.
              </p>
            </div>
          ) : null}
        </HudPanel>
      </div>
    </main>
  );
}
