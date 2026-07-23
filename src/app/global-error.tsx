'use client';

import './global.css';
import { useEffect } from 'react';

/**
 * Last-resort error boundary. Next renders this only when the ROOT layout
 * itself throws, which means it replaces that layout entirely — hence the own
 * `<html>` and `<body>`.
 *
 * Nothing here may depend on the app shell: no providers, no `next/font`
 * variables, no `@/components/*`, since a broken component tree is a likely
 * cause of getting here. Only `global.css` is imported, for the theme tokens.
 */
export default function GlobalError({
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
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-void px-5 py-16 antialiased">
        <div className="relative w-full max-w-[600px] border border-violet/40 bg-panel px-6 py-8 sm:px-10 sm:py-11">
          <span
            aria-hidden
            className="pointer-events-none absolute -left-px -top-px h-3 w-3 border-l-2 border-t-2 border-violet"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute -bottom-px -right-px h-3 w-3 border-b-2 border-r-2 border-violet"
          />

          <p className="font-mono text-xs tracking-[0.14em] text-violet-soft">
            // ZENTRA · FATAL
          </p>

          <div role="alert" className="mt-5">
            <h1 className="font-display text-3xl font-bold tracking-[-0.025em] text-text sm:text-[40px]">
              Something broke
            </h1>
            <p className="mt-3.5 text-[15px] leading-relaxed text-muted sm:text-base">
              The application shell failed to load, so this page could not be
              rendered.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center bg-violet px-6 py-3.5 text-sm font-semibold text-white transition-shadow hover:shadow-[0_0_28px_rgba(124,58,237,0.5)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
            >
              Try again
            </button>
            <a
              href="/"
              className="inline-flex items-center border border-fd-border px-6 py-3.5 text-sm font-semibold text-[#e2e8f0] transition-colors hover:border-cyan/60 hover:text-cyan focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
            >
              Back to home
            </a>
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
        </div>
      </body>
    </html>
  );
}
