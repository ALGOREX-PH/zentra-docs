import './global.css';
import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { Space_Grotesk, Inter, JetBrains_Mono } from 'next/font/google';

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

export const metadata: Metadata = {
  title: {
    default: 'Zentra Protocol — Let agents act. Make them prove it.',
    template: '%s — Zentra Protocol',
  },
  description:
    'Zentra lets developers build AI agents that can trigger Stellar payments only after proving, in zero knowledge, that they followed private, user-defined policies. No proof, no payment.',
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
        <RootProvider
          theme={{ attribute: 'class', defaultTheme: 'dark', enableSystem: false }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
