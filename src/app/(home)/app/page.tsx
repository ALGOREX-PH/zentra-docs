'use client';

import { useState } from 'react';
import { ConnectButton } from '@/components/app/connect-button';
import { GetStarted } from '@/components/app/get-started';
import { BalanceCard } from '@/components/app/balance-card';
import { SendForm } from '@/components/app/send-form';
import { Eyebrow } from '@/components/landing/primitives';

export default function AppPage() {
  // Bumped after a successful send so the balance card re-fetches.
  const [refreshSignal, setRefreshSignal] = useState(0);

  return (
    <main
      id="content"
      tabIndex={-1}
      className="zen-grid flex-1 px-5 py-14 focus:outline-none sm:px-7 sm:py-20"
    >
      <div className="mx-auto max-w-[1100px]">
        <header className="flex flex-col gap-6 border-b border-violet/20 pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Eyebrow>// ZENTRA · TESTNET dAPP</Eyebrow>
            <h1 className="font-display text-3xl font-bold tracking-[-0.025em] sm:text-[42px]">
              Stellar testnet wallet
            </h1>
            <p className="mt-3 max-w-[520px] text-[15px] text-muted sm:text-base">
              Connect Freighter, fund your account, and send XLM on the Stellar
              testnet. This is the White-Belt foundation the full Zentra proof
              layer builds on.
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 sm:items-end">
            <ConnectButton />
            <span className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.08em] text-faint">
              <span aria-hidden className="size-1.5 bg-cyan" /> STELLAR TESTNET
            </span>
          </div>
        </header>

        <div className="mt-8">
          <GetStarted />
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {/*
            The guide's funding step links straight here, because Friendbot is the
            gate an unfunded account cannot get past. The wrapper takes focus as
            well as the scroll so a keyboard lands on the panel, and `grid` keeps
            the card stretched to the row height it had as a direct grid item.
          */}
          <div
            id="testnet-balance"
            tabIndex={-1}
            className="grid scroll-mt-24 focus:outline-none"
          >
            <BalanceCard refreshSignal={refreshSignal} />
          </div>
          <SendForm onPaid={() => setRefreshSignal((s) => s + 1)} />
        </div>

        <p className="mt-10 max-w-[640px] font-mono text-xs leading-relaxed text-faint">
          Every result links to <span className="text-muted">stellar.expert</span>{' '}
          so you can verify it independently on-chain.
        </p>
      </div>
    </main>
  );
}
