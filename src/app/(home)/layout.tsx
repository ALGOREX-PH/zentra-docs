import type { ReactNode } from 'react';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { Footer } from '@/components/landing/footer';
import { baseOptions } from '@/lib/layout.shared';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <HomeLayout {...baseOptions()}>
      {children}
      {/* Site chrome, not page content — it stays out of the printed deck. */}
      <div className="print:hidden">
        <Footer />
      </div>
    </HomeLayout>
  );
}
