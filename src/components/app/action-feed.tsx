'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getCount,
  getLatestLedger,
  getRecent,
  pollEvents,
} from '@/lib/stellar/action-log';
import { stellar } from '@/config/stellar';
import { truncateAddress } from '@/lib/stellar/format';
import { HudPanel, Eyebrow } from '@/components/landing/primitives';
import type { ActionEntry } from '@/lib/stellar/types';

const POLL_MS = 6000;
const MAX_SHOWN = 25;

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

  const merge = useCallback((incoming: ActionEntry[]) => {
    if (incoming.length === 0) return;
    setEntries((prev) => {
      const seen = new Set(prev.map((e) => e.index));
      const fresh = incoming.filter((e) => !seen.has(e.index));
      if (fresh.length === 0) return prev;
      return [...fresh, ...prev]
        .sort((a, b) => b.index - a.index)
        .slice(0, MAX_SHOWN);
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

  useEffect(() => {
    void seed();
  }, [seed, refreshSignal]);

  useEffect(() => {
    const id = setInterval(async () => {
      if (cursor.current == null) return;
      try {
        const { entries: incoming, latestLedger } = await pollEvents(cursor.current);
        merge(incoming);
        if (incoming.length > 0) {
          const highest = Math.max(...incoming.map((e) => e.index));
          setCount((c) => Math.max(c ?? 0, highest + 1));
        }
        cursor.current = latestLedger + 1;
      } catch {
        // no new ledger yet, or a transient RPC hiccup — retry next tick
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [merge]);

  return (
    <HudPanel accent="cyan">
      <div className="p-5 sm:p-6">
        <Eyebrow accent="cyan">LIVE ON-CHAIN FEED</Eyebrow>
        <div className="mb-4 flex items-center gap-2 font-mono text-[11px] text-faint">
          <span aria-hidden className="size-1.5 rounded-full bg-live animate-pulse" />
          {count === null ? '—' : count} action{count === 1 ? '' : 's'} recorded · polling every 6s
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
          <ul className="divide-y divide-fd-border border border-fd-border">
            {entries.map((entry) => (
              <li key={entry.index} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3 font-mono text-[11px] text-faint">
                  <a
                    href={stellar.explorerAccountUrl(entry.author)}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-cyan"
                  >
                    {truncateAddress(entry.author)}
                  </a>
                  <span>
                    #{entry.index} · ledger {entry.ledger}
                  </span>
                </div>
                <p className="mt-1.5 break-words text-sm text-text">{entry.message}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </HudPanel>
  );
}
