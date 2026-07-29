'use client';

import type { ComponentProps, ReactNode } from 'react';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { Footer } from '@/components/landing/footer';
import { baseOptions } from '@/lib/layout.shared';
import { cn } from '@/lib/cn';

/**
 * Shell wrapper for the `(home)` group.
 *
 * Fumadocs' default container is itself a `<main>` that also holds the nav, so
 * every page's own `<main>` would nest inside it and the header would lose its
 * banner role. Swapping in a plain element leaves exactly one main landmark —
 * the page's — and keeps the id Fumadocs' stylesheet selects on.
 */
function HomeContainer({ className, children }: ComponentProps<'main'>) {
  return (
    <div
      id="nd-home-layout"
      className={cn('flex flex-1 flex-col [--fd-layout-width:1400px]', className)}
    >
      {children}
      {/* Site chrome, not page content — it stays out of the printed deck. */}
      <div className="print:hidden">
        <Footer />
      </div>
    </div>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <HomeLayout {...baseOptions()} slots={{ container: HomeContainer }}>
      {children}
    </HomeLayout>
  );
}
