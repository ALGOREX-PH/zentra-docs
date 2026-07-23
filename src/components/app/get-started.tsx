'use client';

import { useId, useState, type ReactNode } from 'react';
import { useWallet } from '@/components/app/wallet-provider';
import { HudPanel, Eyebrow } from '@/components/landing/primitives';
import { cn } from '@/lib/cn';

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan';

/** What we can honestly say about a step: finished, up next, or unknown. */
type StepStatus = 'done' | 'current' | 'pending';

const STEPS: ReadonlyArray<{ title: string; body: ReactNode }> = [
  {
    title: 'Install Freighter',
    body: (
      <>
        Zentra signs with{' '}
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
        </a>
        , a browser extension wallet for Stellar. Install it, create or import an
        account, then reload this page.
      </>
    ),
  },
  {
    title: 'Switch Freighter to Testnet',
    body: (
      <>
        Open Freighter, use the network selector, and pick{' '}
        <span className="text-text">Test Net</span>. This dApp runs on the Stellar
        testnet only — no real funds are involved. Then use{' '}
        <span className="text-text">Connect Wallet</span> above.
      </>
    ),
  },
  {
    title: 'Get free test XLM',
    body: (
      <>
        A new testnet account holds nothing until Friendbot seeds it. Use{' '}
        <span className="text-text">Fund with Friendbot</span> in the Testnet
        balance panel below — it funds the connected account in one call.
      </>
    ),
  },
];

/**
 * Only claim what the connection actually proves. A live address means the
 * extension is installed and pointed at testnet (steps 1 and 2); funding is
 * owned by the balance panel, so step 3 stays "current" rather than "done".
 * With no wallet we know nothing, so every later step renders neutral.
 */
function statusFor(index: number, connected: boolean): StepStatus {
  if (!connected) return index === 0 ? 'current' : 'pending';
  return index === STEPS.length - 1 ? 'current' : 'done';
}

const BADGE: Record<StepStatus, string | null> = {
  done: 'Done',
  current: 'Next',
  pending: null,
};

/**
 * First-run onboarding for the testnet dApp.
 *
 * A visitor landing on /app has no way to know they need the Freighter
 * extension, that it must be switched to Test Net, or that a fresh account has
 * no XLM until Friendbot funds it. This spells out those three steps and marks
 * each one against observable wallet state.
 *
 * Progressive disclosure: once a wallet is connected the guide collapses to a
 * one-line confirmation so a returning user's wallet UI stays above the fold,
 * with a "Need help?" toggle to bring the steps back.
 */
export function GetStarted() {
  const { address } = useWallet();
  // null = follow the wallet; true/false = the user overrode it via the toggle.
  const [override, setOverride] = useState<boolean | null>(null);
  const panelId = useId();

  const connected = address !== null;
  const expanded = override ?? !connected;

  return (
    <HudPanel accent={connected ? 'cyan' : 'violet'}>
      <div className={expanded ? 'p-5 sm:p-6' : 'p-4 sm:px-5 sm:py-4'}>
        {connected ? (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <p className="flex items-center gap-2 font-mono text-[11px] leading-relaxed tracking-[0.06em] text-muted sm:text-xs">
              <span aria-hidden className="size-1.5 shrink-0 bg-live" />
              Wallet connected on testnet. Setup done.
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
            <Eyebrow accent={connected ? 'cyan' : 'violet'}>
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
                const status = statusFor(i, connected);
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
