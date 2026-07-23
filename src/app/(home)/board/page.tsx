'use client';

import { useState } from 'react';
import { ConnectButton } from '@/components/app/connect-button';
import { RecordForm } from '@/components/app/record-form';
import { ActionFeed } from '@/components/app/action-feed';
import { Eyebrow } from '@/components/landing/primitives';
import { actionLog } from '@/config/contract';
import { stellar } from '@/config/stellar';
import { truncateAddress } from '@/lib/stellar/format';

const contractUrl = stellar.explorerContractUrl(actionLog.contractId);

export default function BoardPage() {
  // Bumped after a successful record so the feed re-seeds immediately.
  const [refreshSignal, setRefreshSignal] = useState(0);

  return (
    <main className="zen-grid px-5 py-14 sm:px-7 sm:py-20">
      <div className="mx-auto max-w-[1100px]">
        <header className="flex flex-col gap-6 border-b border-violet/20 pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Eyebrow>// ZENTRA · ON-CHAIN ACTION BOARD</Eyebrow>
            <h1 className="font-display text-3xl font-bold tracking-[-0.025em] sm:text-[42px]">
              Record a verifiable action
            </h1>
            <p className="mt-3 max-w-[560px] text-[15px] text-muted sm:text-base">
              Write a message to a Soroban contract on Stellar testnet, then watch
              it stream into the live feed. Connect any supported wallet — every
              action is signed, on-chain, and independently verifiable.
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 sm:items-end">
            <ConnectButton />
            <a
              href={contractUrl}
              target="_blank"
              rel="noreferrer"
              title="View the contract on Stellar Expert"
              className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.06em] text-faint transition-colors hover:text-cyan"
            >
              <span aria-hidden className="size-1.5 bg-cyan" />
              {truncateAddress(actionLog.contractId, 6, 6)}
            </a>
          </div>
        </header>

        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <RecordForm onRecorded={() => setRefreshSignal((s) => s + 1)} />
          <ActionFeed refreshSignal={refreshSignal} />
        </div>

        <p className="mt-10 max-w-[680px] font-mono text-xs leading-relaxed text-faint">
          Each <span className="text-muted">record</span> writes to the Action Log
          and makes a <span className="text-muted">cross-contract call</span> to a
          separate Reputation contract, bumping the author&apos;s score (shown as{' '}
          <span className="text-muted">rep</span>). The feed listens for the{' '}
          <span className="text-muted">recorded</span> event in real time. Set your
          wallet to <span className="text-muted">Test Net</span> before connecting.
        </p>
      </div>
    </main>
  );
}
