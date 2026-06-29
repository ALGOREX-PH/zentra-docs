'use client';

import type { TxState } from '@/lib/stellar/types';
import { stellar } from '@/config/stellar';
import { truncateAddress } from '@/lib/stellar/format';
import { cn } from '@/lib/cn';

const inFlightLabels = {
  building: 'Building transaction…',
  signing: 'Awaiting signature in your wallet…',
  submitting: 'Submitting to testnet…',
} as const;

type InFlightPhase = keyof typeof inFlightLabels;

function isInFlight(phase: TxState['phase']): phase is InFlightPhase {
  return phase === 'building' || phase === 'signing' || phase === 'submitting';
}

function HashLink({ hash }: { hash: string }) {
  return (
    <a
      href={stellar.explorerTxUrl(hash)}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-xs text-cyan underline-offset-2 hover:underline"
    >
      Tx {truncateAddress(hash)}
    </a>
  );
}

export function TxStatus({ state }: { state: TxState }) {
  if (state.phase === 'idle') return null;

  if (isInFlight(state.phase)) {
    return (
      <div className="flex items-center gap-3 border border-fd-border bg-abyss px-4 py-3 font-mono text-[13px] text-muted">
        <span className="size-2 rounded-full bg-cyan animate-pulse" />
        <span>{state.message ?? inFlightLabels[state.phase]}</span>
      </div>
    );
  }

  if (state.phase === 'success') {
    return (
      <div className="border border-live/40 bg-live/[0.06] px-4 py-3">
        <h3 className="flex items-center gap-2 font-mono uppercase tracking-wide text-live">
          <svg
            width="15"
            height="15"
            viewBox="0 0 15 15"
            fill="none"
            aria-hidden="true"
          >
            <polyline
              points="2,8 6,12 13,3"
              fill="none"
              stroke="#22c55e"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Payment settled
        </h3>
        {state.message ? (
          <p className="mt-1 font-mono text-[13px] text-muted">{state.message}</p>
        ) : null}
        {state.hash ? (
          <div className={cn('mt-2')}>
            <HashLink hash={state.hash} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="border border-denied/40 bg-denied/[0.06] px-4 py-3">
      <h3 className="font-mono uppercase tracking-wide text-denied">
        Payment failed
      </h3>
      <p className="mt-1 font-mono text-[13px] text-muted">
        {state.message ?? 'Something went wrong.'}
      </p>
      {state.hash ? (
        <div className="mt-2">
          <HashLink hash={state.hash} />
        </div>
      ) : null}
    </div>
  );
}
