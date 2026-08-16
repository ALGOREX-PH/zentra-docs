'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWallet } from '@/components/app/wallet-provider';
import { useXlmBalance } from '@/components/app/use-xlm-balance';
import { fundWithFriendbot } from '@/lib/stellar/account';
import { formatXlm, truncateAddress } from '@/lib/stellar/format';
import { describeError } from '@/lib/stellar/errors';
import { stellar } from '@/config/stellar';
import { activeProfile } from '@/config/network';
import { HudPanel, Eyebrow } from '@/components/landing/primitives';
import { cn } from '@/lib/cn';

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan';

const buttonClass = cn(
  'border border-fd-border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted transition-colors hover:border-cyan/40 hover:text-cyan disabled:opacity-50',
  focusRing,
);

type BalanceCardProps = {
  refreshSignal?: number;
};

export function BalanceCard({ refreshSignal }: BalanceCardProps) {
  const { address } = useWallet();
  // The read itself lives in the shared hook, so this card and the onboarding
  // guide watch one poll instead of hitting Horizon independently — and a
  // funding triggered here is visible to the guide the moment it lands.
  const { balance, funded, loading, error: readError, refresh } = useXlmBalance(address);
  const [funding, setFunding] = useState(false);
  const [fundError, setFundError] = useState<string | null>(null);

  // A Friendbot failure stops mattering the moment the account turns out to be
  // funded anyway — from a retry, or from the CLI in another window. Without
  // this, the shared poll could show a balance beside a stale funding error.
  useEffect(() => {
    if (funded) setFundError(null);
  }, [funded]);

  /**
   * The parent bumps `refreshSignal` after a send settles. The ref keeps the
   * initial value from forcing a second read on mount — the hook already reads
   * when it first sees the address.
   */
  const lastSignal = useRef(refreshSignal);
  useEffect(() => {
    if (refreshSignal === lastSignal.current) return;
    lastSignal.current = refreshSignal;
    refresh();
  }, [refreshSignal, refresh]);

  const handleFund = useCallback(async () => {
    if (!address) return;
    setFunding(true);
    setFundError(null);
    try {
      await fundWithFriendbot(address);
      // The shared refresh, so every consumer of the balance sees the funding
      // at once rather than on its own next poll.
      refresh();
    } catch (err) {
      setFundError(describeError(err));
    } finally {
      setFunding(false);
    }
  }, [address, refresh]);

  // Friendbot failing and the read failing are different problems with
  // different fixes; whichever happened most recently is the one shown.
  const error = fundError ?? readError;

  return (
    <HudPanel accent="cyan">
      <div className="p-5 sm:p-6">
        {/* Named for the chain actually being read, so a mainnet build never
            captions real funds as a testnet figure. */}
        <Eyebrow accent="cyan">{activeProfile.label.toUpperCase()} BALANCE</Eyebrow>

        {!address ? (
          <p className="mt-4 font-mono text-sm text-muted">
            Connect your wallet to view your balance.
          </p>
        ) : loading ? (
          <p className="mt-4 font-mono text-sm text-muted">Loading balance…</p>
        ) : error && balance === null ? (
          // `getXlmBalance` only answers null for an account Horizon has never
          // seen; a thrown error means the read itself failed, so it must not
          // be reported as "this account isn't funded".
          <div className="mt-4 space-y-4">
            <p className="font-mono text-sm text-denied">{error}</p>
            <button
              type="button"
              onClick={refresh}
              disabled={funding}
              className={buttonClass}
            >
              Retry
            </button>
          </div>
        ) : balance === null ? (
          // Friendbot only exists where `hasFriendbot` says it does. On
          // mainnet the truthful offer is no button at all: lumens there are
          // bought, and a "Fund" control would promise a faucet that isn't.
          <div className="mt-4 space-y-4">
            {stellar.hasFriendbot ? (
              <>
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
              </>
            ) : (
              <p className="font-mono text-sm text-muted">
                This account isn&apos;t funded yet. There is no faucet on{' '}
                {activeProfile.label} — send it XLM from an exchange or another
                wallet to activate it.
              </p>
            )}
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
              className={cn('font-mono text-xs text-faint hover:text-cyan', focusRing)}
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
              {/* Topping up an already-active account is still a Friendbot
                  call, so it is gated the same way as the first funding. */}
              {stellar.hasFriendbot ? (
                <button
                  type="button"
                  onClick={handleFund}
                  disabled={funding}
                  className={buttonClass}
                >
                  {funding ? 'Funding…' : 'Fund'}
                </button>
              ) : null}
            </div>
          </div>
        )}

        {error && balance !== null ? (
          <p className="mt-4 font-mono text-xs text-denied">{error}</p>
        ) : null}
      </div>
    </HudPanel>
  );
}
