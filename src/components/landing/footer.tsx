import Link from 'next/link';
import { ZentraMark } from '@/components/brand/zentra-mark';
import { repoUrl } from '@/lib/shared';

const LINKS = [
  { label: 'Docs', href: '/docs' },
  { label: 'Playground', href: '/playground' },
  { label: 'Blog', href: '/blog' },
  { label: 'Roadmap', href: '/roadmap' },
  { label: 'GitHub', href: repoUrl, external: true },
];

export function Footer() {
  return (
    <footer className="border-t border-fd-border">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-12 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <ZentraMark size={24} title="Zentra Protocol" />
          <span className="font-display text-sm font-bold tracking-[0.04em]">ZENTRA</span>
          <span className="font-mono text-[10px] tracking-wider text-fd-muted-foreground">
            No proof, no payment.
          </span>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-fd-muted-foreground">
          {LINKS.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              {...(l.external ? { target: '_blank', rel: 'noreferrer' } : {})}
              className="transition-colors hover:text-fd-foreground"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
