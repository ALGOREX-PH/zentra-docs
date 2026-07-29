import './global.css';
import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { Space_Grotesk, Inter, JetBrains_Mono } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { siteUrl } from '@/lib/site';

const display = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  display: 'swap',
});

const sans = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

const title = 'Zentra Protocol — Let agents act. Make them prove it.';
const description =
  'Zentra lets developers build AI agents that can trigger Stellar payments only after proving, in zero knowledge, that they followed private, user-defined policies. No proof, no payment.';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  referrer: 'strict-origin-when-cross-origin',
  title: { default: title, template: '%s — Zentra Protocol' },
  description,
  openGraph: {
    title,
    description,
    type: 'website',
    // Relative, so each route resolves it against its own path. A fixed origin
    // here made every shared link claim to be the landing page.
    url: './',
    siteName: 'Zentra Protocol',
    // Declared at the file's true pixel size. The card is authored at 1200x630
    // and rendered at 2x for high-density displays, so quoting the design size
    // would misdescribe the asset a crawler actually fetches.
    images: [{ url: '/og.png', width: 2400, height: 1260, alt: 'Zentra Protocol — let agents act, make them prove it.' }],
  },
  twitter: { card: 'summary_large_image', title, description, images: ['/og.png'] },
};

export const viewport: Viewport = {
  themeColor: '#06070d',
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-screen flex-col font-sans antialiased">
        {/* First focusable element in the document, so keyboard and screen
            reader users can jump the nav on every route. It is parked above the
            viewport rather than hidden with `sr-only`, which keeps the reveal
            from depending on utility ordering. Every route marks its content
            landmark `id="content"`. */}
        <a
          href="#content"
          className="fixed left-4 top-4 z-50 -translate-y-24 border border-cyan bg-panel px-4 py-2.5 font-mono text-xs tracking-[0.08em] text-cyan transition-transform focus:translate-y-0 print:hidden"
        >
          Skip to content
        </a>
        <RootProvider theme={{ attribute: 'class', forcedTheme: 'dark' }}>
          {children}
        </RootProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
