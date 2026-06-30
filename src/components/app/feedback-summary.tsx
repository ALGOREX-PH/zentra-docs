'use client';

import { useEffect, useState } from 'react';
import { truncateAddress } from '@/lib/stellar/format';
import { stellar } from '@/config/stellar';
import { HudPanel, Eyebrow } from '@/components/landing/primitives';
import { cn } from '@/lib/cn';

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
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed with ${res.status}`);
        return res.json() as Promise<FeedbackResponse>;
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load feedback.');
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
        <Eyebrow accent="cyan">WHAT USERS SAY</Eyebrow>

        {loading && !data ? (
          <p className="font-mono text-sm text-muted">Loading feedback…</p>
        ) : error && !data ? (
          <p className="font-mono text-xs text-denied">{error}</p>
        ) : !data || data.count === 0 ? (
          <p className="font-mono text-sm text-muted">No feedback yet — be the first.</p>
        ) : (
          <>
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
                <li key={`${item.txHash ?? item.createdAt}-${index}`} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3 font-mono text-[11px] text-faint">
                    <span className="text-cyan" aria-label={`${item.rating} out of 5 stars`}>
                      {'★'.repeat(item.rating)}
                    </span>
                    <span className="flex items-center gap-2">
                      {item.wallet ? (
                        <a
                          href={stellar.explorerAccountUrl(item.wallet)}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-cyan"
                        >
                          {truncateAddress(item.wallet)}
                        </a>
                      ) : null}
                      {item.onChain && item.txHash ? (
                        <a
                          href={stellar.explorerTxUrl(item.txHash)}
                          target="_blank"
                          rel="noreferrer"
                          className={cn('border border-live/40 px-1.5 py-0.5 text-live hover:text-cyan')}
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
