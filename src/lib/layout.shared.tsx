import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { Logo } from '@/components/brand/logo';
import { repoUrl } from './shared';
import { stellarExpertContractUrl } from '@/config/protocol';

/** Shared nav/footer options for every layout (home, docs, playground…). */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <Logo />,
      transparentMode: 'top',
    },
    links: [
      { text: 'Docs', url: '/docs', active: 'nested-url' },
      { text: 'App', url: '/app' },
      { text: 'Board', url: '/board' },
      { text: 'Metrics', url: '/metrics' },
      { text: 'Playground', url: '/playground' },
      { text: 'Blog', url: '/blog' },
      { text: 'Roadmap', url: '/roadmap' },
      {
        type: 'custom',
        secondary: true,
        children: (
          <a
            href={stellarExpertContractUrl}
            target="_blank"
            rel="noreferrer"
            title="View the live ZentraVerifier on Stellar Expert"
            className="inline-flex items-center gap-1.5 px-2 font-mono text-xs tracking-wide text-fd-muted-foreground transition-colors hover:text-fd-foreground"
          >
            <span className="text-cyan">◍</span> Live on testnet
          </a>
        ),
      },
    ],
    githubUrl: repoUrl,
    themeSwitch: { enabled: false },
  };
}
