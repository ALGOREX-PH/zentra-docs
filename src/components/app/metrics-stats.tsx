'use client';

import { useEffect, useState } from 'react';
import { getCount, getRecent } from '@/lib/stellar/action-log';
import { getFeedbackCount, getFeedbackAuthors } from '@/lib/stellar/feedback';
import { HudPanel } from '@/components/landing/primitives';
import { cn } from '@/lib/cn';

/**
 * Live on-chain usage stats read straight from the Soroban contracts: total
 * interactions across the action-log and feedback contracts, the distinct wallets
 * behind them, and the network — the product's proof of real wallet interactions.
 */
export function MetricsStats({ refreshSignal = 0 }: { refreshSignal?: number }) {
  const [interactions, setInteractions] = useState<number | null>(null);
  const [wallets, setWallets] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [actionTotal, actionRecent, feedbackTotal, feedbackAuthors] =
          await Promise.all([
            getCount(),
            getRecent(20),
            getFeedbackCount(),
            getFeedbackAuthors(20),
          ]);
        if (cancelled) return;
        setInteractions(actionTotal + feedbackTotal);
        setWallets(
          new Set([...actionRecent.map((e) => e.author), ...feedbackAuthors]).size,
        );
      } catch {
        if (cancelled) return;
        setError('Could not load on-chain stats.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSignal]);

  const labelClass = 'font-mono text-[10px] uppercase tracking-[0.12em] text-faint';

  return (
    <div className={cn('flex flex-col gap-2', loading && 'opacity-95')}>
      {error ? <p className="font-mono text-xs text-denied">{error}</p> : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <HudPanel>
          <div className="p-5">
            <div className={labelClass}>ON-CHAIN INTERACTIONS</div>
            <div className="font-display text-3xl font-bold text-text">{interactions ?? '—'}</div>
          </div>
        </HudPanel>
        <HudPanel>
          <div className="p-5">
            <div className={labelClass}>DISTINCT WALLETS</div>
            <div className="font-display text-3xl font-bold text-text">{wallets ?? '—'}</div>
          </div>
        </HudPanel>
        <HudPanel accent="cyan">
          <div className="p-5">
            <div className={labelClass}>NETWORK</div>
            <div className="font-display text-2xl text-cyan">Testnet</div>
            <div className="font-mono text-[11px] text-muted">Soroban · live</div>
          </div>
        </HudPanel>
      </div>
    </div>
  );
}
