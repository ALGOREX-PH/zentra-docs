import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { JoinForm } from '@/components/app/join-form';
import { JoinProgress } from '@/components/app/join-progress';
import { Eyebrow } from '@/components/landing/primitives';

export const metadata: Metadata = {
  title: 'Join the testnet programme',
  description:
    'Register for the Zentra testnet programme — free Stellar testnet access, no real funds involved.',
};

const internalLink =
  'text-cyan underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan';

/**
 * What signing up costs and what it gets you, in the three facts a visitor is
 * actually weighing before they decide the form is worth their email address.
 *
 * Deliberately no time-to-complete claim and no adjectives: each of these is
 * something the repository can be checked against — Friendbot funds testnet
 * accounts, the form is three fields, and /app, /board and /playground are
 * already deployed.
 */
const OFFER: ReadonlyArray<{ label: string; body: string }> = [
  {
    label: 'Free, on testnet',
    body: 'Test XLM comes from Friendbot. No real funds move, there is nothing to pay, and no card is involved.',
  },
  {
    label: 'Three fields',
    body: 'Name, email, and a Stellar testnet address — which fills itself in the moment you connect a wallet.',
  },
  {
    label: 'No waiting on us',
    body: 'You do not need a reply to start. The testnet wallet, the on-chain action board and the proof playground are live now.',
  },
];

/**
 * What happens after the form, in the order it happens.
 *
 * The two on-chain steps are the substance of the programme — a registration is
 * a row in a table, and what is being measured is transactions — so they are
 * stated up front rather than discovered afterwards on the confirmation panel.
 */
const STEPS: ReadonlyArray<{ title: string; body: ReactNode }> = [
  {
    title: 'You register',
    body: (
      <>
        Name, email, wallet. Your email is only ever used to contact you about this programme — it
        is never shown publicly and never displayed beside your wallet. The counter above reads a
        total and nothing else.
      </>
    ),
  },
  {
    title: 'You fund a testnet wallet',
    body: (
      <>
        On{' '}
        <Link href="/app" className={internalLink}>
          /app
        </Link>
        , Friendbot seeds your account with free test XLM in one click, and you can send a payment
        on Stellar testnet.
      </>
    ),
  },
  {
    title: 'You record an action on-chain',
    body: (
      <>
        On{' '}
        <Link href="/board" className={internalLink}>
          /board
        </Link>
        , your wallet signs a write to a Soroban contract, a cross-contract call bumps your
        reputation score, and the transaction hash links to stellar.expert so anyone can verify it.
      </>
    ),
  },
];

export default function JoinPage() {
  return (
    <main
      id="content"
      tabIndex={-1}
      className="zen-grid flex-1 px-5 py-14 focus:outline-none sm:px-7 sm:py-20"
    >
      <div className="mx-auto max-w-[1100px]">
        <header className="border-b border-violet/20 pb-8">
          <Eyebrow>// ZENTRA · TESTNET PROGRAMME</Eyebrow>
          <h1 className="font-display text-3xl font-bold tracking-[-0.025em] sm:text-[42px]">
            Join the testnet programme
          </h1>
          {/*
            The pitch stated once, in the protocol's own words rather than the
            campaign's: Zentra is a zero-knowledge policy layer, and a visitor
            who cannot tell what they are registering for has no reason to.
          */}
          <p className="mt-3 max-w-[680px] text-[15px] leading-relaxed text-muted sm:text-base">
            Zentra is a zero-knowledge policy layer for AI agents on Stellar. Before an agent can
            move money, it proves the payment obeyed a private policy — spending limits, approved
            vendors, a daily budget — and a Soroban contract verifies that proof on-chain before
            anything settles. No proof, no payment. We are onboarding the first 50 people to run it
            on testnet and tell us where it breaks.
          </p>

          <dl className="mt-6 grid gap-px border border-fd-border bg-fd-border sm:grid-cols-3">
            {OFFER.map((item) => (
              <div key={item.label} className="bg-panel p-4">
                <dt className="font-mono text-[11px] uppercase tracking-[0.08em] text-cyan">
                  {item.label}
                </dt>
                <dd className="mt-2 text-[13px] leading-relaxed text-muted">{item.body}</dd>
              </div>
            ))}
          </dl>
        </header>

        {/*
          The form column comes first in the source, so a phone gets the counter
          and the fields directly under the header and the walkthrough follows
          them — reversing that would push the only thing on this page that can
          convert below three paragraphs of explanation.
        */}
        <div className="mt-10 grid gap-5 lg:grid-cols-[minmax(0,620px)_minmax(0,1fr)] lg:gap-6">
          <div className="flex flex-col gap-5">
            <JoinProgress />
            <JoinForm />
          </div>

          <aside
            aria-labelledby="what-happens-next"
            className="h-fit border border-fd-border bg-panel p-5"
          >
            <h2
              id="what-happens-next"
              className="font-mono text-[11px] uppercase tracking-[0.12em] text-violet-soft"
            >
              What happens next
            </h2>
            <ol className="mt-4 flex flex-col gap-4">
              {STEPS.map((step, i) => (
                <li key={step.title} className="flex gap-3">
                  <span
                    aria-hidden
                    className="flex size-6 shrink-0 items-center justify-center border border-fd-border bg-abyss font-mono text-[11px] leading-none text-faint"
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="font-mono text-[13px] tracking-[0.01em] text-text">
                      {step.title}
                    </p>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            {/*
              The limits stated on the way in rather than found out later. People
              who sign up to break a testnet MVP are the ones this programme
              wants, and they are not put off by hearing it is unfinished.
            */}
            <p className="mt-5 border-t border-fd-border pt-4 text-[12px] leading-relaxed text-faint">
              Zentra is a testnet MVP: four Soroban contracts deployed on Stellar testnet, not
              audited, nothing on mainnet. Treat it as a working proof-of-concept — finding where it
              breaks is the point.
            </p>
          </aside>
        </div>
      </div>
    </main>
  );
}
