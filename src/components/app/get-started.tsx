'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { useWallet } from '@/components/app/wallet-provider';
import { getXlmBalance } from '@/lib/stellar/account';
import { HudPanel, Eyebrow } from '@/components/landing/primitives';
import { cn } from '@/lib/cn';

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan';

/** What we can honestly say about a step: finished, up next, or unknown. */
type StepStatus = 'done' | 'current' | 'pending';

/**
 * What the chain says about the connected account's ability to pay a fee.
 *
 * `unknown` is "not read yet" and `unreadable` is "the read itself failed".
 * Both are kept apart from `unfunded` because neither is evidence that the
 * account is empty, and the guide must not claim a gate is closed — or open —
 * on the strength of a failed request.
 */
type Funding = 'unknown' | 'unfunded' | 'funded' | 'unreadable';

const STEPS: ReadonlyArray<{ title: string; body: ReactNode }> = [
  {
    title: 'Install a Stellar wallet',
    body: (
      <>
        Signing goes through the Stellar Wallets Kit, so Freighter, xBull, Albedo,
        LOBSTR, Hana Wallet and Rabet all work — the picker lists whichever of
        them this browser has. With none of them installed,{' '}
        <a
          href="https://www.freighter.app/"
          target="_blank"
          rel="noreferrer"
          className={cn(
            'text-cyan underline-offset-4 hover:underline',
            focusRing,
          )}
        >
          Freighter
        </a>{' '}
        is the shortest route: add the extension, create or import an account,
        then reload this page. Done when your wallet appears as{' '}
        <span className="text-text">Detected</span> — not{' '}
        <span className="text-text">Install</span> — under{' '}
        <span className="text-text">Connect Wallet</span>.
      </>
    ),
  },
  {
    title: 'Switch it to Test Net, then connect',
    body: (
      <>
        Every contract behind this page lives on the Stellar testnet, and a wallet
        left on Mainnet cannot sign for it — no real funds are involved either
        way. Pick <span className="text-text">Test Net</span> in the wallet
        (Freighter keeps that selector at the top of its window), then press{' '}
        <span className="text-text">Connect Wallet</span> above and approve.
        Done when the button becomes your{' '}
        <span className="text-text">G…</span> address. If the picker says it could
        not connect instead, the wallet is locked or still on Mainnet.
      </>
    ),
  },
  {
    title: 'Fund the account from Friendbot',
    body: (
      <>
        A fresh testnet account holds nothing, and an account with no XLM cannot
        pay a transaction fee — nothing here can be signed until that is cleared.
        One action clears it:{' '}
        <span className="text-text">Fund with Friendbot</span> in the Testnet
        balance panel below. Done when that panel stops saying the account
        isn&apos;t funded and shows an XLM figure; if Friendbot is unreachable it
        states the error and offers <span className="text-text">Retry</span>.
      </>
    ),
  },
];

/** The step the on-chain balance answers for. */
const FUND_STEP = 2;

/**
 * How often the balance is re-read while the account still cannot transact.
 *
 * Funding is triggered in the balance panel next door, which has no channel back
 * to this guide, so the guide watches the chain rather than a sibling's state.
 * That also means it notices an account funded from the CLI, the laboratory, or
 * a second tab. Same cadence as the live feed on /board.
 */
const FUND_POLL_MS = 6000;

/**
 * Only claim what observable state proves. A live address means a wallet is
 * installed and pointed at testnet (steps 1 and 2). Funding is proven by the
 * chain and nothing else, so a read that is pending, failed, or zero leaves the
 * funding step "current" instead of quietly promoting it. With no wallet we know
 * nothing, so every later step renders neutral.
 */
function statusFor(index: number, connected: boolean, funding: Funding): StepStatus {
  if (!connected) return index === 0 ? 'current' : 'pending';
  if (index < FUND_STEP) return 'done';
  return funding === 'funded' ? 'done' : 'current';
}

const BADGE: Record<StepStatus, string | null> = {
  done: 'Done',
  current: 'Next',
  pending: null,
};

/**
 * The collapsed one-liner: what the chain said, and nothing past it. Doubles as
 * the spoken announcement, so it stays a plain string.
 */
const SUMMARY: Record<Funding, { dot: string; text: string }> = {
  unknown: {
    dot: 'bg-cyan',
    text: 'Wallet connected. Reading the testnet balance…',
  },
  unfunded: {
    dot: 'bg-denied',
    text: 'Wallet connected, but this account holds no XLM yet.',
  },
  funded: {
    dot: 'bg-live',
    text: 'Wallet connected and funded on testnet.',
  },
  unreadable: {
    dot: 'bg-denied',
    text: 'Wallet connected. The testnet balance could not be read.',
  },
};

/**
 * The funding step is the only one the app can check for itself, so it reports
 * what the check found. Silent while the answer is unknown or already positive —
 * the step badge carries those two on its own.
 */
function FundingNote({ funding }: { funding: Funding }) {
  if (funding === 'unfunded') {
    return (
      <p className="mt-2.5 border border-denied/40 bg-denied/[0.06] px-3 py-2 font-mono text-[11px] leading-relaxed text-denied">
        Checked on-chain: this account holds no XLM, so every signature it
        attempts would fail. Nothing else matters until this is cleared.
      </p>
    );
  }
  if (funding === 'unreadable') {
    return (
      <p className="mt-2.5 border border-fd-border bg-abyss px-3 py-2 font-mono text-[11px] leading-relaxed text-muted">
        The balance read failed, so this step can&apos;t be confirmed either way.
        Retry it from the balance panel below.
      </p>
    );
  }
  return null;
}

/**
 * First-run onboarding for the testnet dApp.
 *
 * A visitor landing on /app has no way to know they need a wallet extension,
 * that it must be switched to Test Net, or that a fresh account has no XLM until
 * Friendbot funds it. This spells out those steps and marks each one against
 * state that can actually be observed — the wallet connection and the account's
 * balance on chain.
 *
 * Progressive disclosure: once the account can transact the guide collapses to a
 * one-line confirmation so a returning user's wallet UI stays above the fold,
 * with a "Need help?" toggle to bring the steps back.
 */
export function GetStarted() {
  const { address } = useWallet();
  // null = follow the wallet; true/false = the user overrode it via the toggle.
  const [override, setOverride] = useState<boolean | null>(null);
  const [funding, setFunding] = useState<Funding>('unknown');
  const panelId = useId();

  useEffect(() => {
    const account = address;
    if (!account) {
      setFunding('unknown');
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    // The address is passed in rather than closed over: a captured `const` is
    // still `string | null` to the checker inside this nested function.
    async function read(target: string) {
      try {
        const balance = await getXlmBalance(target);
        if (cancelled) return;
        // null is an account Horizon has never seen; '0' is one that exists with
        // nothing to spend. Neither can pay a fee, so both read as unfunded.
        const amount = balance === null ? 0 : Number(balance);
        const funded = Number.isFinite(amount) && amount > 0;
        setFunding(funded ? 'funded' : 'unfunded');
        // Funding only travels one way in this flow, so once it lands the poll
        // stops rather than hitting Horizon for the rest of the session.
        if (funded && timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      } catch {
        if (cancelled) return;
        setFunding('unreadable');
      }
    }

    void read(account);
    timer = setInterval(() => void read(account), FUND_POLL_MS);

    return () => {
      cancelled = true;
      if (timer !== null) clearInterval(timer);
    };
  }, [address]);

  const connected = address !== null;
  // Guarded on `connected` so a disconnect cannot leave a stale "funded" frame
  // on screen in the render before the effect resets the read.
  const funded = connected && funding === 'funded';
  /**
   * An unfunded account cannot sign anything, so a connection is not the finish
   * line this collapses on — the funding gate has to be cleared. A read still in
   * flight leaves it collapsed so a returning funded visitor doesn't watch the
   * panel unfold and fold again; the summary says it is still reading rather
   * than claiming the gate is clear.
   */
  const blocked =
    !connected || funding === 'unfunded' || funding === 'unreadable';
  const expanded = override ?? blocked;
  const summary = SUMMARY[funding];

  return (
    <HudPanel accent={funded ? 'cyan' : 'violet'}>
      <div className={expanded ? 'p-5 sm:p-6' : 'p-4 sm:px-5 sm:py-4'}>
        {/*
          The balance read moves this panel between "gate open" and "gate
          cleared" without the user doing anything, which is otherwise a colour
          and a badge. The region is mounted for the life of the component so the
          change is spoken rather than only drawn.
        */}
        <span aria-live="polite" aria-atomic="true" className="sr-only">
          {connected ? summary.text : ''}
        </span>

        {connected ? (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <p className="flex items-center gap-2 font-mono text-[11px] leading-relaxed tracking-[0.06em] text-muted sm:text-xs">
              <span aria-hidden className={cn('size-1.5 shrink-0', summary.dot)} />
              {summary.text}
            </p>
            <button
              type="button"
              onClick={() => setOverride(!expanded)}
              aria-expanded={expanded}
              aria-controls={panelId}
              className={cn(
                'border border-fd-border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted transition-colors hover:border-cyan/40 hover:text-cyan',
                focusRing,
              )}
            >
              {expanded ? 'Hide steps' : 'Need help?'}
            </button>
          </div>
        ) : null}

        <div id={panelId} hidden={!expanded}>
          <div className={cn(connected && 'mt-6')}>
            <Eyebrow accent={funded ? 'cyan' : 'violet'}>
              GET STARTED · 3 STEPS
            </Eyebrow>

            {!connected ? (
              <p className="-mt-2 mb-4 max-w-[560px] text-[13px] leading-relaxed text-muted sm:text-sm">
                Three things stand between a fresh browser and a signed testnet
                payment. Roughly a minute, one time.
              </p>
            ) : null}

            <ol className="border border-fd-border divide-y divide-fd-border">
              {STEPS.map((step, i) => {
                const status = statusFor(i, connected, funding);
                const isCurrent = status === 'current';
                const badge = BADGE[status];

                return (
                  <li
                    key={step.title}
                    aria-current={isCurrent ? 'step' : undefined}
                    className={cn(
                      'flex gap-3 border-l-2 p-3 sm:gap-4 sm:p-4',
                      isCurrent
                        ? 'border-violet bg-violet/[0.06]'
                        : 'border-transparent',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'flex size-6 shrink-0 items-center justify-center border font-mono text-[11px] leading-none sm:size-7 sm:text-xs',
                        status === 'done' &&
                          'border-cyan/50 bg-cyan/10 text-cyan',
                        status === 'current' &&
                          'border-violet/60 bg-violet/20 text-violet-soft',
                        status === 'pending' &&
                          'border-fd-border bg-abyss text-faint',
                      )}
                    >
                      {i + 1}
                    </span>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                        <span
                          className={cn(
                            'font-mono text-[13px] tracking-[0.01em] sm:text-sm',
                            status === 'done' ? 'text-muted' : 'text-text',
                          )}
                        >
                          {step.title}
                        </span>
                        {badge ? (
                          <span
                            className={cn(
                              'font-mono text-[10px] uppercase tracking-[0.12em]',
                              status === 'done'
                                ? 'text-cyan'
                                : 'text-violet-soft',
                            )}
                          >
                            {badge}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1.5 max-w-[560px] text-[13px] leading-relaxed text-muted">
                        {step.body}
                      </p>
                      {i === FUND_STEP ? <FundingNote funding={funding} /> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>
    </HudPanel>
  );
}
