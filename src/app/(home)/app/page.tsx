'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ConnectButton } from '@/components/app/connect-button';
import { GetStarted } from '@/components/app/get-started';
import { BalanceCard } from '@/components/app/balance-card';
import { SendForm } from '@/components/app/send-form';
import { HudPanel, Eyebrow } from '@/components/landing/primitives';

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
              Connect a Stellar wallet, fund it from Friendbot, and send XLM on the Stellar testnet.
              This is the White-Belt foundation the full Zentra proof layer builds on.
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
          <div id="testnet-balance" tabIndex={-1} className="grid scroll-mt-24 focus:outline-none">
            <BalanceCard refreshSignal={refreshSignal} />
          </div>
          <SendForm onPaid={() => setRefreshSignal((s) => s + 1)} />
        </div>

        {/*
          A balance is where this page's job ends, and on its own it is where the
          user stops too. The next move sits directly under the wallet panels
          rather than in the nav, so funding leads somewhere instead of leaving a
          number on screen. Stated unconditionally: this page cannot see whether
          the account is funded — the balance card owns that read — and a CTA that
          guessed would be worse than one that is simply always the next step.
        */}
        <div className="mt-5">
          <HudPanel>
            <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <div>
                <Eyebrow>// NEXT · RECORD ON-CHAIN</Eyebrow>
                <h2 className="font-display text-xl font-bold tracking-[-0.02em] sm:text-2xl">
                  A funded wallet proves nothing on its own
                </h2>
                <p className="mt-2.5 max-w-[560px] text-[13px] leading-relaxed text-muted sm:text-sm">
                  Recording an action is the first thing here that leaves a permanent trace. The
                  Action Log contract stores your message, a cross-contract call bumps your score in
                  the Reputation contract, and the entry heads the live feed as soon as the
                  transaction settles — inside about six seconds for anyone else watching. The
                  invoke pays its own fee from the account above, so fund it first.
                </p>
              </div>
              <Link
                href="/board"
                className="inline-flex shrink-0 items-center gap-2 self-start bg-violet px-4 py-2.5 font-mono text-xs uppercase tracking-[0.1em] text-white transition-colors hover:bg-violet-bright focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan sm:self-auto"
              >
                <span aria-hidden className="size-1.5 bg-cyan" />
                Record an action
              </Link>
            </div>
          </HudPanel>
        </div>

        <p className="mt-10 max-w-[640px] font-mono text-xs leading-relaxed text-faint">
          Every result links to <span className="text-muted">stellar.expert</span> so you can verify
          it independently on-chain.
        </p>
      </div>
    </main>
  );
}
