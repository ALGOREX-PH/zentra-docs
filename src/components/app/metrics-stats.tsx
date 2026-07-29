'use client';

import { useEffect, useState } from 'react';
import { activeProfile } from '@/config/network';
import { getCount, getRecent } from '@/lib/stellar/action-log';
import { getFeedbackCount, getFeedbackAuthors } from '@/lib/stellar/feedback';
import { HudPanel } from '@/components/landing/primitives';
import { cn } from '@/lib/cn';

/**
 * Live on-chain usage stats read straight from the Soroban contracts: total
 * interactions across the action-log and feedback contracts, the distinct wallets
 * behind them, and the network — the product's proof of real wallet interactions.
 */
/**
 * How many recent entries each contract is asked for when counting distinct
 * wallets.
 *
 * Both contracts expose `get_recent(limit)` rather than a set of authors, and
 * each clamps `limit` to its own `MAX_RECENT` of 20 — asking for more returns
 * no more. So the distinct-wallet count is derived from a window, and once the
 * on-chain totals exceed that window it is a lower bound, reported as such
 * rather than silently under-counting.
 */
const SAMPLE = 20;

export function MetricsStats({ refreshSignal = 0 }: { refreshSignal?: number }) {
  const [interactions, setInteractions] = useState<number | null>(null);
  const [wallets, setWallets] = useState<number | null>(null);
  const [partial, setPartial] = useState(false);
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
            getRecent(SAMPLE),
            getFeedbackCount(),
            getFeedbackAuthors(SAMPLE),
          ]);
        if (cancelled) return;
        setInteractions(actionTotal + feedbackTotal);
        setWallets(
          new Set([...actionRecent.map((e) => e.author), ...feedbackAuthors]).size,
        );
        // Compare against the contracts' own totals rather than the requested
        // window: they clamp the limit internally, so a returned page being
        // "full" proves nothing. If either total exceeds what we actually saw,
        // older authors went uncounted and the figure is a floor.
        setPartial(
          actionTotal > actionRecent.length || feedbackTotal > feedbackAuthors.length,
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
    <div aria-busy={loading} className={cn('flex flex-col gap-2', loading && 'opacity-95')}>
      {/*
        The tiles fall back to an em dash whenever a figure is missing, which
        reads the same whether the contracts are still being queried, refused to
        answer, or genuinely hold nothing. One line above them says which.
      */}
      {loading ? (
        <p className="font-mono text-xs text-muted">Reading the contracts…</p>
      ) : error ? (
        <p className="font-mono text-xs text-denied">{error}</p>
      ) : interactions === 0 ? (
        <p className="font-mono text-xs text-muted">
          No on-chain activity yet — record an action or leave feedback to start these counters.
        </p>
      ) : null}
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
            <div className="font-display text-3xl font-bold text-text">
              {wallets === null ? '—' : `${wallets}${partial ? '+' : ''}`}
            </div>
            {partial ? (
              <div className="font-mono text-[11px] text-muted">
                lower bound · last {SAMPLE} per contract
              </div>
            ) : null}
          </div>
        </HudPanel>
        <HudPanel accent="cyan">
          <div className="p-5">
            <div className={labelClass}>NETWORK</div>
            {/*
              Named by the active profile rather than typed in. The chain is a
              deploy-time choice, and a tile that says "Testnet" on a mainnet
              build is not a stale label — it is a false claim about where every
              other figure on this page was read from.
            */}
            <div className="font-display text-2xl text-cyan">{activeProfile.label}</div>
            <div className="font-mono text-[11px] text-muted">Soroban · live</div>
          </div>
        </HudPanel>
      </div>
    </div>
  );
}
