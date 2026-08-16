'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getCount, getLatestLedger, getRecent, pollEvents } from '@/lib/stellar/action-log';
import { stellar } from '@/config/stellar';
import { contractsConfigured } from '@/config/contract';
import { activeProfile } from '@/config/network';
import { truncateAddress } from '@/lib/stellar/format';
import { HudPanel, Eyebrow } from '@/components/landing/primitives';
import { LIVE_POLL_MS } from '@/config/app';
import type { ActionEntry } from '@/lib/stellar/types';
import { focusRing } from '@/lib/ui';
import { cn } from '@/lib/cn';

const MAX_SHOWN = 25;

/**
 * Consecutive poll failures tolerated before reseeding. One or two are RPC
 * hiccups; a third in a row usually means the cursor has aged out of the RPC's
 * event retention (a laptop waking from sleep), and every further tick would
 * fail identically forever.
 */
const FAILURES_BEFORE_RESEED = 3;

/**
 * The live on-chain action feed: seeds history from the contract's `get_recent`
 * read, then listens for new `recorded` events via Soroban RPC `getEvents`,
 * merging fresh entries (deduped by index) so the list stays in sync.
 */
export function ActionFeed({ refreshSignal = 0 }: { refreshSignal?: number }) {
  const [entries, setEntries] = useState<ActionEntry[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cursor = useRef<number | null>(null);
  const tickBusy = useRef(false);
  const failures = useRef(0);

  const merge = useCallback((incoming: ActionEntry[]) => {
    if (incoming.length === 0) return;
    setEntries((prev) => {
      const seen = new Set(prev.map((e) => e.index));
      const fresh = incoming.filter((e) => !seen.has(e.index));
      if (fresh.length === 0) return prev;
      return [...fresh, ...prev].sort((a, b) => b.index - a.index).slice(0, MAX_SHOWN);
    });
  }, []);

  const seed = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [recent, total, latest] = await Promise.all([
        getRecent(20),
        getCount(),
        getLatestLedger(),
      ]);
      setEntries(recent);
      setCount(total);
      cursor.current = latest + 1;
    } catch {
      setError('Could not load the on-chain feed.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Both effects are inert on a network with no deployed contracts: every
  // seed and every tick would be a simulateRead against an empty contract id,
  // failing in a way nobody could diagnose. `contractsConfigured` is a module
  // constant, so these guards never change between renders.
  useEffect(() => {
    if (!contractsConfigured) return;
    void seed();
  }, [seed, refreshSignal]);

  useEffect(() => {
    if (!contractsConfigured) return;
    const id = setInterval(async () => {
      // A hidden tab polls for nobody: skip the tick rather than hit the RPC
      // every six seconds behind a closed laptop lid. The cursor is untouched,
      // so the first tick after the tab returns picks up from where it left
      // off — and if the pause outlived the RPC's event retention, the
      // existing failure counter reseeds exactly as it would after sleep.
      if (document.visibilityState === 'hidden') return;
      // One tick at a time: a slow tick that outlives the interval would race
      // the next one, and whichever resolved last would win the cursor.
      if (cursor.current == null || tickBusy.current) return;
      tickBusy.current = true;
      try {
        const { entries: incoming, latestLedger } = await pollEvents(cursor.current);
        merge(incoming);
        if (incoming.length > 0) {
          const highest = Math.max(...incoming.map((e) => e.index));
          setCount((c) => Math.max(c ?? 0, highest + 1));
        }
        // Monotonic only: a lagging RPC node (or a reseed that finished while
        // this tick was in flight) may answer with an older latestLedger, and
        // rewinding the cursor would re-fetch and re-merge ledgers already seen.
        const next = latestLedger + 1;
        if (cursor.current === null || next > cursor.current) {
          cursor.current = next;
        }
        failures.current = 0;
        setError(null);
      } catch {
        // A hiccup heals on the next tick; three identical failures in a row
        // will not (see FAILURES_BEFORE_RESEED), so reseed to rebuild both the
        // list and the cursor. If the reseed itself fails, the stale banner
        // states it while the counter starts over.
        failures.current += 1;
        if (failures.current >= FAILURES_BEFORE_RESEED) {
          failures.current = 0;
          await seed();
        }
      } finally {
        tickBusy.current = false;
      }
    }, LIVE_POLL_MS);
    return () => clearInterval(id);
  }, [merge, seed]);

  // Stated rather than skipped: an empty frame would read as "no activity",
  // which is a different claim from "this network has nothing deployed to
  // read". Placed after the hooks — the constant never changes at runtime, so
  // the hook order is stable.
  if (!contractsConfigured) {
    return (
      <HudPanel accent="cyan">
        <div className="p-5 sm:p-6">
          <Eyebrow accent="cyan">LIVE ON-CHAIN FEED</Eyebrow>
          <p className="font-mono text-sm text-muted">
            Contracts are not configured for {activeProfile.label} yet, so there is no feed to read.
            See docs/MAINNET.md for the deployment checklist.
          </p>
        </div>
      </HudPanel>
    );
  }

  return (
    <HudPanel accent="cyan">
      <div className="p-5 sm:p-6">
        {/*
          Pre-mounted alert region, as in tx-status: the visible error banner
          appears and disappears with the failure, and a live region born in
          the same render as its text is routinely missed by screen readers.
          This span exists from the first render; only its contents change.
        */}
        <span role="alert" className="sr-only">
          {error ? (entries.length > 0 ? `${error} Showing the last entries loaded.` : error) : ''}
        </span>

        <Eyebrow accent="cyan">LIVE ON-CHAIN FEED</Eyebrow>
        <div className="mb-4 flex items-center gap-2 font-mono text-[11px] text-faint">
          <span aria-hidden className="size-1.5 rounded-full bg-live animate-pulse" />
          {count === null ? '—' : count} action{count === 1 ? '' : 's'} recorded · polling every{' '}
          {LIVE_POLL_MS / 1000}s
        </div>

        {loading && entries.length === 0 ? (
          <p className="font-mono text-sm text-muted">Loading the on-chain feed…</p>
        ) : error && entries.length === 0 ? (
          <p className="font-mono text-xs text-denied">{error}</p>
        ) : entries.length === 0 ? (
          <p className="font-mono text-sm text-muted">
            No actions yet — be the first to record one.
          </p>
        ) : (
          <>
            {/*
              A reseed that fails once entries are on screen used to fail
              silently: the list kept showing whatever it had, with nothing to
              say it had gone stale. The entries stay — they are still real —
              but the staleness is stated.
            */}
            {error ? (
              <p className="mb-3 border border-denied/40 bg-denied/[0.06] px-3 py-2 font-mono text-[11px] text-denied">
                {error} Showing the last entries loaded.
              </p>
            ) : null}
            <ul className="divide-y divide-fd-border border border-fd-border">
              {entries.map((entry) => (
                <li key={entry.index} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3 font-mono text-[11px] text-faint">
                    <span className="flex items-center gap-2">
                      <a
                        href={stellar.explorerAccountUrl(entry.author)}
                        target="_blank"
                        rel="noreferrer"
                        className={cn('hover:text-cyan', focusRing)}
                      >
                        {truncateAddress(entry.author)}
                      </a>
                      <span
                        title="Reputation, bumped via a cross-contract call"
                        className="border border-violet/40 bg-violet/[0.07] px-1.5 py-0.5 text-violet-soft"
                      >
                        rep {entry.score}
                      </span>
                    </span>
                    <span>
                      #{entry.index} · ledger {entry.ledger}
                    </span>
                  </div>
                  <p className="mt-1.5 break-words text-sm text-text">{entry.message}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </HudPanel>
  );
}
