import type { Metadata } from 'next';
import Link from 'next/link';
import { ZentraMark } from '@/components/brand/zentra-mark';
import { HudPanel, Eyebrow } from '@/components/landing/primitives';

export const metadata: Metadata = {
  title: 'Not found',
  description: 'No route exists at this path on Zentra Protocol.',
};

const DESTINATIONS = [
  { href: '/', label: 'HOME', hint: 'Protocol overview' },
  { href: '/docs', label: 'DOCS', hint: 'Quickstart and reference' },
  { href: '/app', label: 'APP', hint: 'Testnet dApp' },
] as const;

const linkFocus =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan';

/**
 * Site-wide 404. Next renders this for any unmatched URL, and for any
 * `notFound()` call that no nested not-found boundary catches. It lives at the
 * root of `src/app`, so it renders inside the root layout only — never the
 * `(home)` group — and therefore carries its own mark and its own navigation.
 */
export default function NotFound() {
  return (
    <main className="zen-grid flex min-h-[80vh] flex-1 items-center justify-center px-5 py-16 sm:px-7 sm:py-24">
      <div className="w-full max-w-[560px]">
        <Link
          href="/"
          className={`mb-8 inline-flex items-center gap-2.5 transition-colors hover:text-cyan ${linkFocus}`}
        >
          <ZentraMark size={24} title="Zentra Protocol" />
          <span className="font-display text-sm font-bold tracking-[0.04em]">
            ZENTRA PROTOCOL
          </span>
        </Link>

        <HudPanel>
          <div className="p-6 sm:p-8">
            <Eyebrow>// ROUTE NOT FOUND</Eyebrow>

            <p
              aria-hidden
              className="font-display text-5xl font-bold leading-none tracking-[-0.03em] text-violet-soft sm:text-6xl"
            >
              404
            </p>

            <h1 className="mt-5 font-display text-2xl font-bold tracking-[-0.025em] sm:text-[30px]">
              No route at this path.
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-muted">
              The page you requested does not exist, or it has moved — the
              destinations below cover everything the protocol currently serves.
            </p>

            <ul className="mt-8 space-y-px border border-fd-border bg-fd-border">
              {DESTINATIONS.map((d) => (
                <li key={d.href}>
                  <Link
                    href={d.href}
                    className="group flex items-center gap-4 bg-panel px-4 py-3.5 transition-colors hover:bg-panel-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cyan"
                  >
                    <span className="font-mono text-[11px] tracking-[0.12em] text-violet-soft">
                      {d.label}
                    </span>
                    <span className="text-sm text-muted">{d.hint}</span>
                    <span
                      aria-hidden
                      className="ml-auto font-mono text-sm text-faint transition-colors group-hover:text-cyan"
                    >
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </HudPanel>

        <p className="mt-6 font-mono text-xs tracking-[0.08em] text-faint">
          NO PROOF · NO PAYMENT
        </p>
      </div>
    </main>
  );
}
