'use client';

import { useState } from 'react';
import { ConnectButton } from '@/components/app/connect-button';
import { MetricsStats } from '@/components/app/metrics-stats';
import { FeedbackForm } from '@/components/app/feedback-form';
import { FeedbackSummary } from '@/components/app/feedback-summary';
import { Eyebrow } from '@/components/landing/primitives';

export default function MetricsPage() {
  // Bumped after feedback is submitted so the summary + stats refetch.
  const [refresh, setRefresh] = useState(0);

  return (
    <main className="zen-grid px-5 py-14 sm:px-7 sm:py-20">
      <div className="mx-auto max-w-[1100px]">
        <header className="flex flex-col gap-6 border-b border-violet/20 pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Eyebrow>// ZENTRA · PRODUCT METRICS</Eyebrow>
            <h1 className="font-display text-3xl font-bold tracking-[-0.025em] sm:text-[42px]">
              Usage &amp; feedback
            </h1>
            <p className="mt-3 max-w-[560px] text-[15px] text-muted sm:text-base">
              Live on-chain usage read straight from the contracts, plus product
              feedback collected both on-chain and in Postgres. Page views and Web
              Vitals are tracked with Vercel Analytics.
            </p>
          </div>
          <ConnectButton />
        </header>

        <div className="mt-10">
          <MetricsStats refreshSignal={refresh} />
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <FeedbackForm onSubmitted={() => setRefresh((r) => r + 1)} />
          <FeedbackSummary refreshSignal={refresh} />
        </div>

        <p className="mt-10 max-w-[680px] font-mono text-xs leading-relaxed text-faint">
          Distinct wallets and total actions are read live from the Soroban
          contracts — verifiable proof of real usage. Feedback anchored on-chain
          links to its transaction on stellar.expert.
        </p>
      </div>
    </main>
  );
}
