import Link from 'next/link';
import { ZentraMark } from '@/components/brand/zentra-mark';
import { repoUrl } from '@/lib/shared';
import { stellarExpertContractUrl } from '@/config/protocol';

export function Footer() {
  return (
    <footer className="border-t border-violet/20 bg-abyss px-5 py-6 sm:px-7 sm:py-8">
      <div className="mx-auto flex max-w-[1160px] flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <ZentraMark size={22} title="Zentra Protocol" />
          <span className="font-display text-sm font-bold tracking-[0.04em]">ZENTRA PROTOCOL</span>
        </div>
        <span className="font-mono text-xs tracking-[0.08em] text-faint">NO PROOF · NO PAYMENT</span>
        <div className="flex gap-6 font-mono text-xs text-muted">
          <Link href="/docs" className="transition-colors hover:text-cyan">DOCS</Link>
          <a href={repoUrl} target="_blank" rel="noreferrer" className="transition-colors hover:text-cyan">GITHUB</a>
          <a href={stellarExpertContractUrl} target="_blank" rel="noreferrer" className="transition-colors hover:text-cyan">STELLAR EXPERT</a>
        </div>
      </div>
    </footer>
  );
}
