'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { activeProfile } from '@/config/network';
import { getCount, getRecent } from '@/lib/stellar/action-log';
import { getFeedbackCount, getFeedbackAuthors } from '@/lib/stellar/feedback';
import { HudPanel, Eyebrow } from '@/components/landing/primitives';
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

  return (
    <div aria-busy={loading} className={cn('flex flex-col gap-2', loading && 'opacity-95')}>
      {/*
        One framed panel rather than a row of loose tiles. The adoption claim is
        only credible read together — the wallets that transacted, what they did,
        and the chain it happened on — and a reviewer has to be able to capture
        the whole thing in one screenshot without cropping half the evidence out.
      */}
      <HudPanel accent="cyan">
        <div className="p-5 sm:p-6">
          <Eyebrow accent="cyan">// ADOPTION · PROOF OF USE</Eyebrow>

          {/*
            The readouts fall back to an em dash whenever a figure is missing,
            which reads the same whether the contracts are still being queried,
            refused to answer, or genuinely hold nothing. One line above them
            says which.
          */}
          {loading ? (
            <p className="font-mono text-xs text-muted">Reading the contracts…</p>
          ) : error ? (
            <p className="font-mono text-xs text-denied">{error}</p>
          ) : interactions === 0 ? (
            <p className="font-mono text-xs text-muted">
              No on-chain activity yet — record an action or leave feedback to start these
              counters.
            </p>
          ) : null}

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Readout
              label="WALLETS SEEN ON-CHAIN"
              value={wallets === null ? '—' : `${wallets}${partial ? '+' : ''}`}
              note={
                partial
                  ? `Lower bound — distinct authors within the last ${SAMPLE} entries per contract, which is the most either read returns.`
                  : 'Distinct addresses that signed a recorded interaction, counted from the chain.'
              }
            />
            <Readout
              label="ON-CHAIN INTERACTIONS"
              value={interactions ?? '—'}
              note="Exact totals from the action-log and feedback contracts' own counters."
            />
            <Readout
              accent="cyan"
              label="NETWORK"
              // Named by the active profile rather than typed in. The chain is a
              // deploy-time choice, and a readout that says "Testnet" on a
              // mainnet build is not a stale label — it is a false claim about
              // where every other figure in this panel was read from.
              value={activeProfile.label}
              note="Soroban — every on-chain figure here is simulated against this network on load."
            />
          </div>
        </div>
      </HudPanel>
    </div>
  );
}

/**
 * One readout cell inside the panel: what is being measured, the figure, and the
 * caveat that keeps the figure from being over-read.
 *
 * The note is not decoration. Signups, wallets and interactions are three
 * different populations, and a bare number under a three-word label is exactly
 * how a reviewer ends up quoting one as another — so every cell has to state
 * what it counts. Plain bordered cells rather than nested {@link HudPanel}s,
 * because the panel already owns the corner brackets.
 */
function Readout({
  label,
  value,
  note,
  accent = 'violet',
}: {
  label: string;
  value: ReactNode;
  note: ReactNode;
  accent?: 'violet' | 'cyan';
}) {
  return (
    <div
      className={cn(
        'border bg-abyss/60 p-4',
        accent === 'cyan' ? 'border-cyan/30' : 'border-violet/20',
      )}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">{label}</div>
      <div
        className={cn(
          'mt-1 font-display text-3xl font-bold',
          accent === 'cyan' ? 'text-cyan' : 'text-text',
        )}
      >
        {value}
      </div>
      <div className="mt-1.5 font-mono text-[11px] leading-relaxed text-muted">{note}</div>
    </div>
  );
}
