'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '@/components/app/wallet-provider';
import { getXlmBalance, fundWithFriendbot } from '@/lib/stellar/account';
import { formatXlm, truncateAddress } from '@/lib/stellar/format';
import { describeError } from '@/lib/stellar/errors';
import { stellar } from '@/config/stellar';
import { HudPanel, Eyebrow } from '@/components/landing/primitives';
import { cn } from '@/lib/cn';

const buttonClass =
  'border border-fd-border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted transition-colors hover:border-cyan/40 hover:text-cyan disabled:opacity-50';

type BalanceCardProps = {
  refreshSignal?: number;
};

export function BalanceCard({ refreshSignal }: BalanceCardProps) {
  const { address } = useWallet();
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [funding, setFunding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localSignal, setLocalSignal] = useState(0);

  useEffect(() => {
    if (!address) {
      setBalance(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getXlmBalance(address)
      .then((result) => {
        if (cancelled) return;
        setBalance(result);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(describeError(err));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address, refreshSignal, localSignal]);

  const refresh = useCallback(() => {
    setLocalSignal((value) => value + 1);
  }, []);

  const handleFund = useCallback(async () => {
    if (!address) return;
    setFunding(true);
    setError(null);
    try {
      await fundWithFriendbot(address);
      setLocalSignal((value) => value + 1);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setFunding(false);
    }
  }, [address]);

  return (
    <HudPanel accent="cyan">
      <div className="p-5 sm:p-6">
        <Eyebrow accent="cyan">TESTNET BALANCE</Eyebrow>

        {!address ? (
          <p className="mt-4 font-mono text-sm text-muted">
            Connect your wallet to view your balance.
          </p>
        ) : loading ? (
          <p className="mt-4 font-mono text-sm text-muted">Loading balance…</p>
        ) : balance === null ? (
          <div className="mt-4 space-y-4">
            <p className="font-mono text-sm text-muted">
              This account isn&apos;t funded on testnet yet.
            </p>
            <button
              type="button"
              onClick={handleFund}
              disabled={funding}
              className={cn(buttonClass, 'border-cyan/40 text-cyan')}
            >
              {funding ? 'Funding…' : 'Fund with Friendbot'}
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div>
              <span className="font-display text-4xl font-bold tracking-tight text-text sm:text-5xl">
                {formatXlm(balance)}
              </span>
              <span className="ml-2 font-mono text-base text-muted">XLM</span>
            </div>

            <a
              href={stellar.explorerAccountUrl(address)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs text-faint hover:text-cyan"
            >
              {truncateAddress(address)}
            </a>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={refresh}
                disabled={funding}
                className={buttonClass}
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={handleFund}
                disabled={funding}
                className={buttonClass}
              >
                {funding ? 'Funding…' : 'Fund'}
              </button>
            </div>
          </div>
        )}

        {error ? (
          <p className="mt-4 font-mono text-xs text-denied">{error}</p>
        ) : null}
      </div>
    </HudPanel>
  );
}
