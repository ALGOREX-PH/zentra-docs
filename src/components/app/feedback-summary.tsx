'use client';

import { useEffect, useState } from 'react';
import { Eyebrow, HudPanel } from '@/components/landing/primitives';
import { stellar } from '@/config/stellar';
import { readApiError } from '@/lib/api/client';
import { cn } from '@/lib/cn';
import { truncateAddress } from '@/lib/stellar/format';
import { focusRing } from '@/lib/ui';

interface FeedbackItem {
  rating: number;
  comment: string;
  wallet: string | null;
  txHash: string | null;
  onChain: boolean;
  createdAt: string;
}

interface FeedbackResponse {
  count: number;
  average: number;
  onChain: number;
  recent: FeedbackItem[];
}

/** Whether `value` is shaped like one stored review. */
function isFeedbackItem(value: unknown): value is FeedbackItem {
  if (typeof value !== 'object' || value === null) return false;
  const { rating, comment, wallet, txHash, onChain, createdAt } = value as {
    rating?: unknown;
    comment?: unknown;
    wallet?: unknown;
    txHash?: unknown;
    onChain?: unknown;
    createdAt?: unknown;
  };
  return (
    // A non-integer or negative rating would make `'★'.repeat(rating)` throw.
    typeof rating === 'number' &&
    Number.isInteger(rating) &&
    rating >= 0 &&
    typeof comment === 'string' &&
    (wallet === null || typeof wallet === 'string') &&
    (txHash === null || typeof txHash === 'string') &&
    typeof onChain === 'boolean' &&
    typeof createdAt === 'string'
  );
}

/** Whether `value` is shaped like the `/api/feedback` summary. */
function isFeedbackResponse(value: unknown): value is FeedbackResponse {
  if (typeof value !== 'object' || value === null) return false;
  const { count, average, onChain, recent } = value as {
    count?: unknown;
    average?: unknown;
    onChain?: unknown;
    recent?: unknown;
  };
  return (
    typeof count === 'number' &&
    typeof average === 'number' &&
    typeof onChain === 'number' &&
    Array.isArray(recent) &&
    recent.every(isFeedbackItem)
  );
}

/**
 * A summary of user feedback plus the most recent comments, read from the
 * backend `/api/feedback` route. On-chain reviews link out to Stellar Expert so
 * the rating can be independently verified against the recorded transaction.
 */
export function FeedbackSummary({ refreshSignal = 0 }: { refreshSignal?: number }) {
  const [data, setData] = useState<FeedbackResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch('/api/feedback')
      .then(async (res) => {
        // The API answers every failure with the same envelope, so a rate limit
        // or a storage outage can say so instead of showing a bare status code.
        if (!res.ok) throw new Error(await readApiError(res, 'Could not load feedback.'));
        // Asserting the shape would let a changed payload — or a proxy's HTML
        // error page — reach `average.toFixed` and take the panel down with a
        // TypeError, when the catch below already knows how to report it.
        const body: unknown = await res.json();
        if (!isFeedbackResponse(body)) throw new Error('Could not load feedback.');
        return body;
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load feedback.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshSignal]);

  return (
    <HudPanel accent="cyan">
      <div className="p-5 sm:p-6">
        {/*
          Pre-mounted alert region, as in tx-status: the visible error line and
          the stale banner both appear in the same render as the failure they
          announce, and a live region born with its text is routinely missed by
          screen readers. This span exists from the first render.
        */}
        <span role="alert" className="sr-only">
          {error ? (data ? `${error} Showing the last response loaded.` : error) : ''}
        </span>

        <Eyebrow accent="cyan">WHAT USERS SAY</Eyebrow>

        {loading && !data ? (
          <p className="font-mono text-sm text-muted">Loading feedback…</p>
        ) : error && !data ? (
          <p className="font-mono text-xs text-denied">{error}</p>
        ) : !data || data.count === 0 ? (
          <p className="font-mono text-sm text-muted">No feedback yet — be the first.</p>
        ) : (
          <>
            {/*
              A refresh that fails after the first load used to be invisible:
              the summary kept showing the previous response as if it were
              current. The figures stay, with a line saying they may not be.
            */}
            {error ? (
              <p className="mb-3 border border-denied/40 bg-denied/[0.06] px-3 py-2 font-mono text-[11px] text-denied">
                {error} Showing the last response loaded.
              </p>
            ) : null}

            <div className="mb-4 flex items-baseline gap-2">
              <span className="font-display text-3xl text-text">
                {data.average.toFixed(1)}
                <span className="text-cyan"> ★</span>
              </span>
              <span className="font-mono text-[11px] text-muted">
                · {data.count} review{data.count === 1 ? '' : 's'} · {data.onChain} on-chain
              </span>
            </div>

            <ul className="divide-y divide-fd-border border border-fd-border">
              {data.recent.map((item, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: the index only tiebreaks rows sharing txHash/createdAt; the list is replaced wholesale on refresh, never reordered.
                <li key={`${item.txHash ?? item.createdAt}-${index}`} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3 font-mono text-[11px] text-faint">
                    <span
                      role="img"
                      className="text-cyan"
                      aria-label={`${item.rating} out of 5 stars`}
                    >
                      {'★'.repeat(item.rating)}
                    </span>
                    <span className="flex items-center gap-2">
                      {item.wallet ? (
                        <a
                          href={stellar.explorerAccountUrl(item.wallet)}
                          target="_blank"
                          rel="noreferrer"
                          className={cn('hover:text-cyan', focusRing)}
                        >
                          {truncateAddress(item.wallet)}
                        </a>
                      ) : null}
                      {item.onChain && item.txHash ? (
                        <a
                          href={stellar.explorerTxUrl(item.txHash)}
                          target="_blank"
                          rel="noreferrer"
                          className={cn(
                            'border border-live/40 px-1.5 py-0.5 text-live hover:text-cyan',
                            focusRing,
                          )}
                        >
                          on-chain
                        </a>
                      ) : null}
                    </span>
                  </div>
                  <p className="mt-1.5 break-words text-sm text-text">{item.comment}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </HudPanel>
  );
}
