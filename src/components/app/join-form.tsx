'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { ConnectButton } from '@/components/app/connect-button';
import { InviteLink } from '@/components/app/invite-link';
import { StarRating } from '@/components/app/star-rating';
import { WalletProvider, useWallet } from '@/components/app/wallet-provider';
import { readApiError } from '@/lib/api/client';
import { HudPanel, Eyebrow } from '@/components/landing/primitives';
import { truncateAddress } from '@/lib/stellar/format';
import {
  inspectWallet,
  normaliseWallet,
  validate,
  walletMessage,
  MAX_NAME,
  MAX_NOTE,
  WALLET_LENGTH,
  type Field,
} from '@/lib/stellar/wallet-input';
import { focusRing } from '@/lib/ui';
import { cn } from '@/lib/cn';

const fieldClass = cn(
  'w-full border border-fd-border bg-abyss px-3 py-2.5 font-mono text-sm text-text placeholder:text-faint transition-colors focus:border-violet/60',
  focusRing,
);

const labelClass =
  'mb-1.5 block font-mono text-[11px] uppercase tracking-[0.08em] text-faint';

const primaryAction = cn(
  'inline-flex shrink-0 items-center gap-2 bg-violet px-4 py-2.5 font-mono text-xs uppercase tracking-[0.1em] text-white transition-colors hover:bg-violet-bright',
  focusRing,
);

const secondaryAction = cn(
  'inline-flex shrink-0 items-center gap-2 border border-fd-border px-4 py-2.5 font-mono text-xs uppercase tracking-[0.1em] text-muted transition-colors hover:border-cyan/40 hover:text-cyan',
  focusRing,
);

/**
 * `duplicate` is a separate outcome rather than a flavour of `error`.
 *
 * A 409 means the email or the wallet is already in the registry — from the
 * visitor's side that is the goal, already met. Rendering it in the error slot
 * showed someone red text for having succeeded twice, and sent them away from
 * the on-chain steps that the programme is actually counted on.
 */
type Status = 'idle' | 'sending' | 'success' | 'duplicate' | 'error';

/**
 * The two transactions that turn a registration into actual activity.
 *
 * Order is load-bearing, not presentational: a Soroban write pays a network fee,
 * so an account Friendbot has not funded yet cannot do the second one. Both run
 * on the same testnet the signup registered a wallet for.
 */
const NEXT_STEPS: ReadonlyArray<{
  href: string;
  cta: string;
  title: string;
  body: string;
}> = [
  {
    href: '/app',
    cta: 'Fund the wallet',
    title: 'Fund your testnet wallet',
    body:
      'Friendbot seeds the account you just registered with free test XLM. Do this first — the next step pays a network fee, and a fresh account has nothing to pay it with.',
  },
  {
    href: '/board',
    cta: 'Record an action',
    title: 'Record an action on-chain',
    body:
      'Write a message to the Action Log contract. Your wallet signs it, a cross-contract call bumps your reputation score, and the settled transaction hash links to stellar.expert so anyone can verify it.',
  },
];

/**
 * Public signup for the testnet programme.
 *
 * The wallet context is mounted here rather than in a route layout: /join is a
 * marketing page and this form is the only thing on it that wants an address,
 * so visitors who never reach the form never pay for the wallet kit.
 */
export function JoinForm() {
  return (
    <WalletProvider>
      <SignupForm />
    </WalletProvider>
  );
}

function SignupForm() {
  const { address } = useWallet();
  const ids = useId();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [wallet, setWallet] = useState('');
  const [rating, setRating] = useState(0);
  const [note, setNote] = useState('');

  // The connected address is only a suggestion. Once the visitor types in the
  // field it is their value, not the wallet's, and rehydration must not undo it.
  const [walletEdited, setWalletEdited] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (walletEdited || !address) return;
    setWallet(address);
  }, [address, walletEdited]);

  const errors = validate({ name, email, wallet, note });
  const walletState = inspectWallet(wallet);
  const inFlight = status === 'sending';
  const prefilled = !walletEdited && address !== null && wallet === address;
  const noteOver = note.trim().length > MAX_NOTE;

  /** An error is only worth showing once the visitor has left the field. */
  function errorFor(field: Field): string | null {
    return touched[field] ? (errors[field] ?? null) : null;
  }

  function markTouched(field: Field) {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (Object.keys(errors).length > 0) {
      // Reachable now that the button is no longer disabled while the form is
      // incomplete, and this is what the trade buys: one press reveals every
      // outstanding field error at once and announces that it did, instead of a
      // dead control whose reason for being dead the visitor has to guess at.
      // No request goes out, so none of the three write attempts is spent.
      setTouched({ name: true, email: true, wallet: true, note: true });
      setStatus('error');
      setError('Check the fields marked above.');
      return;
    }

    setStatus('sending');
    setError(null);

    try {
      const trimmedNote = note.trim();
      const res = await fetch('/api/onboard', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          wallet: wallet.trim(),
          // Omitted rather than nulled: the API treats absent as "not given".
          rating: rating > 0 ? rating : undefined,
          note: trimmedNote.length > 0 ? trimmedNote : undefined,
        }),
      });

      // Checked before `res.ok` so a repeat registration never reaches the
      // error path: they are on the list, which is the only thing this form was
      // asking for, and the next steps are the same either way.
      if (res.status === 409) {
        setStatus('duplicate');
        return;
      }

      if (!res.ok) throw new Error(await readApiError(res, 'Could not complete signup.'));

      setStatus('success');
    } catch (err: unknown) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Could not complete signup.');
    }
  }

  /**
   * Success swaps the whole panel out, which a screen reader has no reason to
   * notice. Rendering this region as the first child of both branches keeps one
   * node across the switch, so the outcome is spoken instead of just drawn.
   */
  const announcement = (
    <p aria-live="polite" aria-atomic="true" className="sr-only">
      {status === 'success'
        ? 'You are on the list. Next: fund your testnet wallet, then record an action on-chain.'
        : status === 'duplicate'
          ? 'You are already registered. Next: fund your testnet wallet, then record an action on-chain.'
          : ''}
    </p>
  );

  if (status === 'success' || status === 'duplicate') {
    return (
      <>
        {announcement}
        <HudPanel accent="cyan">
          <div className="p-5 sm:p-6">
            <Eyebrow accent="cyan">YOU ARE ON THE LIST</Eyebrow>
            {status === 'duplicate' ? (
              // Which of the two collided is deliberately not reported by the
              // API — saying would turn the endpoint into a lookup oracle for
              // whether a given address is registered — so neither is claimed
              // back, and no wallet is echoed as "yours".
              <p className="max-w-[520px] text-[15px] leading-relaxed text-text">
                This email or wallet is already registered, so there is nothing left
                to fill in here.
              </p>
            ) : (
              <p className="max-w-[520px] text-[15px] leading-relaxed text-text">
                Registered{' '}
                <span className="font-mono text-cyan">{truncateAddress(wallet, 6, 6)}</span>. We
                will email you about the testnet programme — nothing else.
              </p>
            )}

            {/*
              The panel used to end at that thank-you, which is exactly where
              this funnel leaked. A signup is a row in a table; what the
              programme is measured on is on-chain activity. So the panel now
              hands over the next two transactions while the wallet that was
              just registered is still connected and still in front of them.
            */}
            <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.08em] text-faint">
              Signing up is not the on-chain part · these two steps are
            </p>
            <ol className="mt-2 divide-y divide-fd-border border border-fd-border">
              {NEXT_STEPS.map((step, i) => (
                <li
                  key={step.href}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-5"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-[13px] tracking-[0.01em] text-text">
                      <span aria-hidden className="text-cyan">
                        {i + 1} ·{' '}
                      </span>
                      {step.title}
                    </p>
                    <p className="mt-1.5 max-w-[420px] text-[13px] leading-relaxed text-muted">
                      {step.body}
                    </p>
                  </div>
                  <Link href={step.href} className={i === 0 ? primaryAction : secondaryAction}>
                    {i === 0 ? <span aria-hidden className="size-1.5 bg-cyan" /> : null}
                    {step.cta}
                  </Link>
                </li>
              ))}
            </ol>

            <p className="mt-4 max-w-[520px] text-[13px] leading-relaxed text-muted">
              Or generate a real Groth16 proof in your own browser in the{' '}
              <Link
                href="/playground"
                className={cn('text-cyan underline-offset-4 hover:underline', focusRing)}
              >
                proof playground
              </Link>
              .
            </p>

            <InviteLink />
          </div>
        </HudPanel>
      </>
    );
  }

  const nameError = errorFor('name');
  const emailError = errorFor('email');
  const noteError = errorFor('note');

  /**
   * The wallet field reports itself as it is typed, not on blur like the others.
   *
   * A bad paste and a half-finished paste are the only two ways 56 characters go
   * wrong, and both are visible the instant they happen — so waiting for a blur
   * only means the visitor discovers it after they have gone looking for the
   * submit button. Just the "you have not filled this in" case still waits, since
   * naming an empty field before it is touched is nagging, not help.
   */
  const walletNotice =
    walletState.kind === 'empty' ? errorFor('wallet') : walletMessage(walletState);

  /**
   * The standing description under the field: the shape to aim for, or that the
   * value already has it. The live character count belongs to the notice above,
   * so the two lines never say the same thing twice.
   */
  const walletHint = prefilled
    ? 'From your connected wallet — edit it if you want to register a different account.'
    : walletState.kind === 'valid'
      ? 'Valid Stellar account id.'
      : address === null
        ? `Connect above to fill this in, or paste your account id — G then ${WALLET_LENGTH - 1} characters (A–Z, 2–7).`
        : `Paste your account id — G then ${WALLET_LENGTH - 1} characters (A–Z, 2–7).`;

  return (
    <>
      {announcement}
      <HudPanel accent="violet">
        <div className="p-5 sm:p-6">
          <Eyebrow>REGISTER</Eyebrow>

          <form onSubmit={handleSubmit} noValidate>
            <label htmlFor={`${ids}-name`} className={labelClass}>
              Name
            </label>
            <input
              id={`${ids}-name`}
              name="name"
              type="text"
              maxLength={MAX_NAME}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => markTouched('name')}
              aria-invalid={nameError !== null}
              aria-describedby={nameError ? `${ids}-name-error` : undefined}
              className={fieldClass}
            />
            {nameError ? (
              <p id={`${ids}-name-error`} className="mt-1 font-mono text-[11px] text-denied">
                {nameError}
              </p>
            ) : null}

            <label htmlFor={`${ids}-email`} className={cn(labelClass, 'mt-4')}>
              Email
            </label>
            <input
              id={`${ids}-email`}
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onBlur={() => markTouched('email')}
              aria-invalid={emailError !== null}
              aria-describedby={emailError ? `${ids}-email-error` : undefined}
              className={fieldClass}
            />
            {emailError ? (
              <p id={`${ids}-email-error`} className="mt-1 font-mono text-[11px] text-denied">
                {emailError}
              </p>
            ) : null}

            <label htmlFor={`${ids}-wallet`} className={cn(labelClass, 'mt-4')}>
              Stellar wallet
            </label>
            {/*
              The connected path put in front of the field instead of described
              underneath it. The hint here used to say "connect a wallet
              anywhere on the site" — but /join has no wallet UI of its own and
              the provider is mounted in this component, so the only visitors
              who ever got an autofill were the ones arriving with a session
              from /app or /board. Everyone else was quietly asked to hand-type
              56 base32 characters, which is the worst step in this funnel.
            */}
            {address === null ? (
              <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2.5 border border-violet/30 bg-violet/[0.06] p-3">
                <ConnectButton />
                <p className="font-mono text-[11px] leading-relaxed text-muted">
                  Fills the address in for you — nothing to sign, nothing to type.
                </p>
              </div>
            ) : wallet !== address ? (
              // A way back to the connected account, because the alternative
              // after a stray keystroke is retyping the whole address.
              <button
                type="button"
                onClick={() => {
                  setWalletEdited(false);
                  setWallet(address);
                }}
                className={cn(
                  'mb-2 inline-flex items-center gap-2 border border-fd-border px-3 py-1.5 font-mono text-[11px] text-muted transition-colors hover:border-cyan/40 hover:text-cyan',
                  focusRing,
                )}
              >
                <span aria-hidden className="size-1.5 bg-live" />
                Use connected wallet {truncateAddress(address, 6, 6)}
              </button>
            ) : null}
            <input
              id={`${ids}-wallet`}
              name="wallet"
              type="text"
              required
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="characters"
              placeholder="G…"
              value={wallet}
              onChange={(event) => {
                setWalletEdited(true);
                setWallet(normaliseWallet(event.target.value));
              }}
              onBlur={() => markTouched('wallet')}
              aria-invalid={walletNotice !== null}
              aria-describedby={[walletNotice ? `${ids}-wallet-error` : null, `${ids}-wallet-hint`]
                .filter(Boolean)
                .join(' ')}
              className={fieldClass}
            />
            {walletNotice ? (
              // Coloured by severity rather than by which slot it sits in: a
              // running character count is progress, not a fault, and painting
              // it red would make correct typing look like a mistake.
              <p
                id={`${ids}-wallet-error`}
                className={cn(
                  'mt-1 font-mono text-[11px]',
                  walletState.kind === 'typing' ? 'text-muted' : 'text-denied',
                )}
              >
                {walletNotice}
              </p>
            ) : null}
            <p
              id={`${ids}-wallet-hint`}
              className={cn(
                'mt-1 font-mono text-[11px]',
                walletState.kind === 'valid' && !prefilled ? 'text-live' : 'text-faint',
              )}
            >
              {walletHint}
            </p>

            <span id={`${ids}-rating-label`} className={cn(labelClass, 'mt-4')}>
              Rating (optional)
            </span>
            <StarRating value={rating} onChange={setRating} labelledBy={`${ids}-rating-label`} />

            <label htmlFor={`${ids}-note`} className={cn(labelClass, 'mt-4')}>
              Note (optional)
            </label>
            <textarea
              id={`${ids}-note`}
              name="note"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              onBlur={() => markTouched('note')}
              placeholder="What are you hoping to build?"
              aria-invalid={noteError !== null}
              aria-describedby={[noteError ? `${ids}-note-error` : null, `${ids}-note-count`]
                .filter(Boolean)
                .join(' ')}
              className={cn(fieldClass, 'resize-none')}
            />

            <div className="mt-1 flex items-start justify-between gap-3 font-mono text-[11px]">
              {noteError ? (
                <p id={`${ids}-note-error`} className="text-denied">
                  {noteError}
                </p>
              ) : (
                <span />
              )}
              <span
                id={`${ids}-note-count`}
                className={cn('shrink-0 text-faint', noteOver && 'text-denied')}
              >
                {note.length}/{MAX_NOTE}
              </span>
            </div>

            {/*
              Disabled only while the request is in flight, never for an
              incomplete form. A submit button that greys itself out is the last
              step of a funnel refusing to say what is wrong — the press has to
              be allowed for the answer to arrive.
            */}
            <button
              type="submit"
              disabled={inFlight}
              className={cn(
                'mt-4 w-full bg-violet px-4 py-3 font-mono text-xs uppercase tracking-[0.1em] text-white transition-colors hover:bg-violet-bright disabled:cursor-not-allowed disabled:opacity-50',
                focusRing,
              )}
            >
              {inFlight ? 'Registering…' : 'Join the testnet programme'}
            </button>

            {/* Mounted from the first render so the alert is not created and
                filled in the same tick, which screen readers routinely miss. */}
            <p
              role="alert"
              className={cn(
                'font-mono text-xs text-denied',
                status === 'error' && error && 'mt-2',
              )}
            >
              {status === 'error' && error ? error : ''}
            </p>
          </form>

          <p className="mt-4 max-w-[520px] text-[12px] leading-relaxed text-faint">
            Your email is used only to contact you about the Zentra testnet
            programme. It is never displayed publicly, never shown alongside your
            wallet, and never sold or shared.
          </p>
        </div>
      </HudPanel>
    </>
  );
}
