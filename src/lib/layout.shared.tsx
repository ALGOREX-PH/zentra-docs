import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { Logo } from '@/components/brand/logo';
import { repoUrl } from './shared';

/** Shared nav/footer options for every layout (home, docs, playground…). */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <Logo />,
      transparentMode: 'top',
    },
    links: [
      { text: 'Docs', url: '/docs', active: 'nested-url' },
      { text: 'Playground', url: '/playground' },
      { text: 'Blog', url: '/blog' },
      { text: 'Roadmap', url: '/roadmap' },
    ],
    githubUrl: repoUrl,
  };
}
