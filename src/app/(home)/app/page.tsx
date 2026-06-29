'use client';

import { useState } from 'react';
import { ConnectButton } from '@/components/app/connect-button';
import { BalanceCard } from '@/components/app/balance-card';
import { SendForm } from '@/components/app/send-form';
import { Eyebrow } from '@/components/landing/primitives';

export default function AppPage() {
  // Bumped after a successful send so the balance card re-fetches.
  const [refreshSignal, setRefreshSignal] = useState(0);

  return (
    <main className="zen-grid px-5 py-14 sm:px-7 sm:py-20">
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

        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <BalanceCard refreshSignal={refreshSignal} />
          <SendForm onPaid={() => setRefreshSignal((s) => s + 1)} />
        </div>

        <p className="mt-10 max-w-[640px] font-mono text-xs leading-relaxed text-faint">
          Tip: set Freighter to the <span className="text-muted">Test Net</span>{' '}
          network before connecting. Need test XLM? Use the{' '}
          <span className="text-muted">Fund</span> button — it asks Friendbot to
          seed your account. Every result links to stellar.expert so you can
          verify it independently on-chain.
        </p>
      </div>
    </main>
  );
}
