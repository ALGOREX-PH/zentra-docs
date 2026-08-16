'use client';

import Link from 'next/link';
import { type ReactNode, useId, useState } from 'react';
import { useXlmBalance } from '@/components/app/use-xlm-balance';
import { useWallet } from '@/components/app/wallet-provider';
import { Eyebrow, HudPanel } from '@/components/landing/primitives';
import { cn } from '@/lib/cn';
import { focusRing } from '@/lib/ui';

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
        Signing goes through the Stellar Wallets Kit, so Freighter, xBull, Albedo, LOBSTR, Hana
        Wallet and Rabet all work — the picker lists all six and flags which of them this browser
        has. With none of them installed,{' '}
        <a
          href="https://www.freighter.app/"
          target="_blank"
          rel="noreferrer"
          className={cn('text-cyan underline-offset-4 hover:underline', focusRing)}
        >
          Freighter
        </a>{' '}
        is the shortest route: add the extension, create or import an account, then reload this
        page. Done when your wallet appears as <span className="text-text">Detected</span> — not{' '}
        <span className="text-text">Install</span> — under{' '}
        <span className="text-text">Connect Wallet</span>.
      </>
    ),
  },
  {
    title: 'Switch it to Test Net, then connect',
    body: (
      <>
        Every contract behind this page lives on the Stellar testnet, and a wallet left on Mainnet
        cannot sign for it — no real funds are involved either way. Pick{' '}
        <span className="text-text">Test Net</span> in the wallet (Freighter keeps that selector at
        the top of its window), then press <span className="text-text">Connect Wallet</span> above
        and approve. Done when the button becomes your <span className="text-text">G…</span>{' '}
        address. If the picker says it could not connect instead, the wallet is locked or still on
        Mainnet.
      </>
    ),
  },
  {
    title: 'Fund the account from Friendbot',
    body: (
      <>
        A fresh testnet account holds nothing, and an account with no XLM cannot pay a transaction
        fee — nothing here can be signed until that is cleared. One action clears it:{' '}
        <a
          href="#testnet-balance"
          className={cn('text-cyan underline-offset-4 hover:underline', focusRing)}
        >
          Fund with Friendbot
        </a>{' '}
        in the Testnet balance panel below. Done when that panel stops saying the account isn&apos;t
        funded and shows an XLM figure; if Friendbot is unreachable it states the error and offers{' '}
        <span className="text-text">Retry</span>.
      </>
    ),
  },
  {
    title: 'Record an action on-chain',
    body: (
      <>
        A funded wallet is the prerequisite, not the point.{' '}
        <Link
          href="/board"
          className={cn('text-cyan underline-offset-4 hover:underline', focusRing)}
        >
          Open the board
        </Link>
        , write up to 200 characters and sign: the Action Log contract stores the entry, a
        cross-contract call bumps your score in the Reputation contract, and a{' '}
        <span className="text-text">recorded</span> event goes out. Done when the form hands back a
        transaction hash you can open on stellar.expert — your entry heads the live feed the moment
        the transaction settles, and anyone else watching picks it up on the next six-second poll.
      </>
    ),
  },
];

/** The step the on-chain balance answers for. */
const FUND_STEP = 2;

/**
 * Only claim what observable state proves. A live address means a wallet is
 * installed and pointed at testnet (steps 1 and 2). Funding is proven by the
 * chain and nothing else, so a read that is pending, failed, or zero leaves the
 * funding step "current" instead of quietly promoting it. With no wallet we know
 * nothing, so every later step renders neutral.
 *
 * The recording step never reads as done: nothing on this page can see a write
 * made on /board, so it stays the current step rather than guessing at one.
 */
function statusFor(index: number, connected: boolean, funding: Funding): StepStatus {
  if (!connected) return index === 0 ? 'current' : 'pending';
  if (index < FUND_STEP) return 'done';
  if (funding !== 'funded') return index === FUND_STEP ? 'current' : 'pending';
  return index === FUND_STEP ? 'done' : 'current';
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
    text: 'Wallet connected and funded on testnet. Next: record an action.',
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
        Checked on-chain: this account holds no XLM, so every signature it attempts would fail.
        Nothing else matters until this is cleared.
      </p>
    );
  }
  if (funding === 'unreadable') {
    return (
      <p className="mt-2.5 border border-fd-border bg-abyss px-3 py-2 font-mono text-[11px] leading-relaxed text-muted">
        The balance read failed, so this step can&apos;t be confirmed either way. Retry it from the
        balance panel below.
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
 * The list deliberately runs one step past this page. A funded wallet that never
 * records anything is not activity, so the last step hands the user to /board,
 * where a write actually lands on-chain.
 *
 * Progressive disclosure: once the account can transact the guide collapses to a
 * one-line confirmation so a returning user's wallet UI stays above the fold,
 * with a "Need help?" toggle to bring the steps back.
 */
export function GetStarted() {
  const { address } = useWallet();
  // null = follow the wallet; true/false = the user overrode it via the toggle.
  const [override, setOverride] = useState<boolean | null>(null);
  const panelId = useId();

  /**
   * The shared balance read (`useXlmBalance`) rather than a poll of this
   * guide's own: funding is triggered in the balance panel next door, and the
   * shared store is what lets its `refresh()` land here in the same tick. The
   * hook keeps the old semantics — it watches the chain, not a sibling's
   * state, so an account funded from the CLI, the laboratory or a second tab
   * is noticed on the next poll, and the poll stops once funding lands.
   */
  const { funded: fundedRead, error: readError } = useXlmBalance(address);

  /**
   * Collapse the hook's state into the guide's vocabulary. A failed read
   * outranks a stale success: the old figure may still be on screen in the
   * balance card, but this guide's job is to say whether the gate is *known*
   * to be clear, and right now it is not.
   */
  const funding: Funding =
    address === null
      ? 'unknown'
      : readError !== null
        ? 'unreadable'
        : fundedRead === null
          ? 'unknown'
          : fundedRead
            ? 'funded'
            : 'unfunded';

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
  const blocked = !connected || funding === 'unfunded' || funding === 'unreadable';
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
            <div className="flex items-center gap-2">
              {/*
                Collapsed is the state a returning visitor sees most, so the one
                thing left to do has to survive the collapse — otherwise the guide
                folds away and the flow ends on a balance figure.
              */}
              {funded ? (
                <Link
                  href="/board"
                  className={cn(
                    'inline-flex items-center gap-2 bg-violet px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-white transition-colors hover:bg-violet-bright',
                    focusRing,
                  )}
                >
                  <span aria-hidden className="size-1.5 bg-cyan" />
                  Record an action
                </Link>
              ) : null}
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
          </div>
        ) : null}

        <div id={panelId} hidden={!expanded}>
          <div className={cn(connected && 'mt-6')}>
            <Eyebrow accent={funded ? 'cyan' : 'violet'}>GET STARTED · 4 STEPS</Eyebrow>

            {!connected ? (
              <p className="-mt-2 mb-4 max-w-[560px] text-[13px] leading-relaxed text-muted sm:text-sm">
                Four things stand between a fresh browser and your first action recorded on-chain. A
                couple of minutes, one time.
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
                      isCurrent ? 'border-violet bg-violet/[0.06]' : 'border-transparent',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'flex size-6 shrink-0 items-center justify-center border font-mono text-[11px] leading-none sm:size-7 sm:text-xs',
                        status === 'done' && 'border-cyan/50 bg-cyan/10 text-cyan',
                        status === 'current' && 'border-violet/60 bg-violet/20 text-violet-soft',
                        status === 'pending' && 'border-fd-border bg-abyss text-faint',
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
                              status === 'done' ? 'text-cyan' : 'text-violet-soft',
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
