'use client';

import { useState } from 'react';
import { ConnectButton } from '@/components/app/connect-button';
import { FeedbackForm } from '@/components/app/feedback-form';
import { FeedbackSummary } from '@/components/app/feedback-summary';
import { MetricsStats } from '@/components/app/metrics-stats';
import { Eyebrow } from '@/components/landing/primitives';

export default function MetricsPage() {
  // Bumped after feedback is submitted so the summary + stats refetch.
  const [refresh, setRefresh] = useState(0);

  return (
    <main
      id="content"
      tabIndex={-1}
      className="zen-grid flex-1 px-5 py-14 focus:outline-none sm:px-7 sm:py-20"
    >
      <div className="mx-auto max-w-[1100px]">
        <header className="flex flex-col gap-6 border-b border-violet/20 pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Eyebrow>// ZENTRA · PRODUCT METRICS</Eyebrow>
            <h1 className="font-display text-3xl font-bold tracking-[-0.025em] sm:text-[42px]">
              Usage &amp; feedback
            </h1>
            <p className="mt-3 max-w-[560px] text-[15px] text-muted sm:text-base">
              The whole adoption picture in one panel: registry signups, the wallets that actually
              transacted, and what they did — each labelled with what it measures, and stamped with
              the network, ledger and time it was read at. Below it, product feedback collected both
              on-chain and in Postgres. Page views and Web Vitals are tracked with Vercel Analytics.
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

        {/*
          Repeated under the panel because this is the one confusion that would
          make the numbers above worthless: a reviewer who reads "signups" as
          "active wallets" has been handed a figure nobody claimed. Neither is
          derived from the other, and only one of them is proof.
        */}
        <p className="mt-10 max-w-[680px] font-mono text-xs leading-relaxed text-faint">
          Signups and on-chain wallets are separate counts. A signup is a row somebody submitted; a
          wallet in the on-chain count signed a transaction the contracts recorded, which is the
          only one of the two that proves usage. Distinct wallets stay a lower bound for as long as
          the contracts hold more entries than one capped read returns. Feedback anchored on-chain
          links to its transaction on stellar.expert.
        </p>
      </div>
    </main>
  );
}
