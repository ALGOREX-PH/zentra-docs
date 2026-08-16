'use client';

import { stellar } from '@/config/stellar';
import { cn } from '@/lib/cn';
import { truncateAddress } from '@/lib/stellar/format';
import type { TxState } from '@/lib/stellar/types';
import { focusRing } from '@/lib/ui';

/**
 * What each in-flight phase says while the outcome is still open.
 *
 * Exported so a form that manages its own pipeline (feedback's anchored retry)
 * can announce the same words at the same moments instead of paraphrasing.
 */
export const inFlightLabels = {
  building: 'Building transaction…',
  signing: 'Awaiting signature in your wallet…',
  submitting: 'Submitting to testnet…',
} as const;

type InFlightPhase = keyof typeof inFlightLabels;

function isInFlight(phase: TxState['phase']): phase is InFlightPhase {
  return phase === 'building' || phase === 'signing' || phase === 'submitting';
}

/**
 * Outcome copy, overridable per flow.
 *
 * The panel was written for payments and its headings said so — a contract
 * invoke that ends in "Payment settled" reports something that did not happen.
 * Callers recording anything other than a payment pass their own copy; the
 * defaults keep every existing payment surface word-for-word.
 */
export interface TxStatusLabels {
  /** Heading over the success panel, e.g. "Payment settled". */
  success: string;
  /** Heading over the failure panel, e.g. "Payment failed". */
  failure: string;
  /**
   * Sentence opener for the spoken success announcement. Defaults to
   * `${success}.` — override it when the heading alone reads oddly as speech.
   */
  successAnnounce?: string;
}

const paymentLabels: TxStatusLabels = {
  success: 'Payment settled',
  failure: 'Payment failed',
};

function HashLink({ hash }: { hash: string }) {
  return (
    <a
      href={stellar.explorerTxUrl(hash)}
      target="_blank"
      rel="noreferrer"
      className={cn('font-mono text-xs text-cyan underline-offset-2 hover:underline', focusRing)}
    >
      Tx {truncateAddress(hash)}
    </a>
  );
}

/**
 * The same information the panel shows, flattened to one sentence.
 *
 * A phase change is otherwise a colour and an icon: nothing a screen reader
 * would report, even though "awaiting signature" is exactly when the user needs
 * to be told to look at their wallet.
 */
function announce(state: TxState, labels: TxStatusLabels): string {
  if (state.phase === 'idle') return '';
  if (isInFlight(state.phase)) return state.message ?? inFlightLabels[state.phase];
  if (state.phase === 'success') {
    const opener = labels.successAnnounce ?? `${labels.success}.`;
    return state.message ? `${opener} ${state.message}` : opener;
  }
  return `${labels.failure}. ${state.message ?? 'Something went wrong.'}`;
}

export function TxStatus({
  state,
  labels = paymentLabels,
}: {
  state: TxState;
  labels?: TxStatusLabels;
}) {
  const spoken = announce(state, labels);

  return (
    <>
      {/*
        Both regions stay mounted for the life of the form. A live region that
        appears at the same moment as its text is routinely missed, so the nodes
        exist from the first render and only their contents change.
      */}
      <span aria-live="polite" aria-atomic="true" className="sr-only">
        {state.phase === 'error' ? '' : spoken}
      </span>
      <span role="alert" className="sr-only">
        {state.phase === 'error' ? spoken : ''}
      </span>
      <StatusPanel state={state} labels={labels} />
    </>
  );
}

function StatusPanel({ state, labels }: { state: TxState; labels: TxStatusLabels }) {
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
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
            {/* stroke-live rather than a literal hex, so the checkmark follows
                the theme token the border and heading already read from. */}
            <polyline
              points="2,8 6,12 13,3"
              fill="none"
              className="stroke-live"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {labels.success}
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
      <h3 className="font-mono uppercase tracking-wide text-denied">{labels.failure}</h3>
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
