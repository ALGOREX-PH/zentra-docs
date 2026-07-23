'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { WalletProvider, useWallet } from '@/components/app/wallet-provider';
import { readApiError } from '@/lib/api/client';
import { HudPanel, Eyebrow } from '@/components/landing/primitives';
import { cn } from '@/lib/cn';

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan';

const fieldClass = cn(
  'w-full border border-fd-border bg-abyss px-3 py-2.5 font-mono text-sm text-text placeholder:text-faint transition-colors focus:border-violet/60',
  focusRing,
);

const labelClass =
  'mb-1.5 block font-mono text-[11px] uppercase tracking-[0.08em] text-faint';

const MAX_NAME = 80;
const MAX_NOTE = 500;

/** Same shapes the API validates against, so the form fails before the fetch. */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const STELLAR_ACCOUNT_ID = /^G[A-Z2-7]{55}$/;

type Status = 'idle' | 'sending' | 'success' | 'error';

type Field = 'name' | 'email' | 'wallet' | 'note';

type FieldErrors = Partial<Record<Field, string>>;

interface Values {
  name: string;
  email: string;
  wallet: string;
  note: string;
}

/**
 * Mirror of the server's rules, worded for a person rather than a validator.
 *
 * Duplicating them is deliberate: the API is still the authority, but a signup
 * that can be fixed without a round trip — and without burning one of three
 * rate-limited attempts — is the difference between a registration and a bounce.
 */
function validate({ name, email, wallet, note }: Values): FieldErrors {
  const errors: FieldErrors = {};

  const trimmedName = name.trim();
  if (trimmedName.length < 1) errors.name = 'Enter your name.';
  else if (trimmedName.length > MAX_NAME) errors.name = `Name must be ${MAX_NAME} characters or fewer.`;

  if (!EMAIL.test(email.trim())) errors.email = 'Enter a valid email address.';

  if (!STELLAR_ACCOUNT_ID.test(wallet.trim())) {
    errors.wallet = 'Enter a Stellar account id — G followed by 55 characters.';
  }

  if (note.trim().length > MAX_NOTE) errors.note = `Note must be ${MAX_NOTE} characters or fewer.`;

  return errors;
}

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
  const inFlight = status === 'sending';
  const disabled = inFlight || Object.keys(errors).length > 0;
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
      setTouched({ name: true, email: true, wallet: true, note: true });
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

      if (!res.ok) {
        // A duplicate is a success from the visitor's side — they are on the
        // list — so it gets its own wording instead of the generic envelope.
        throw new Error(
          res.status === 409
            ? 'You are already registered — thanks.'
            : await readApiError(res, 'Could not complete signup.'),
        );
      }

      setStatus('success');
    } catch (err: unknown) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Could not complete signup.');
    }
  }

  if (status === 'success') {
    return (
      <HudPanel accent="cyan">
        <div className="p-5 sm:p-6">
          <Eyebrow accent="cyan">YOU ARE ON THE LIST</Eyebrow>
          <p className="max-w-[520px] text-[15px] leading-relaxed text-text">
            Thanks for joining. We will email you about the testnet programme —
            nothing else.
          </p>
          <p className="mt-3 max-w-[520px] text-[13px] leading-relaxed text-muted">
            You do not have to wait for us. Everything is live on Stellar testnet
            right now.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/app"
              className={cn(
                'inline-flex items-center gap-2 bg-violet px-4 py-2.5 font-mono text-xs uppercase tracking-[0.1em] text-white transition-colors hover:bg-violet-bright',
                focusRing,
              )}
            >
              <span aria-hidden className="size-1.5 bg-cyan" />
              Open the testnet app
            </Link>
            <Link
              href="/playground"
              className={cn(
                'inline-flex items-center border border-fd-border px-4 py-2.5 font-mono text-xs uppercase tracking-[0.1em] text-muted transition-colors hover:border-cyan/40 hover:text-cyan',
                focusRing,
              )}
            >
              Try the playground
            </Link>
          </div>
        </div>
      </HudPanel>
    );
  }

  const nameError = errorFor('name');
  const emailError = errorFor('email');
  const walletError = errorFor('wallet');
  const noteError = errorFor('note');

  return (
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
          <input
            id={`${ids}-wallet`}
            name="wallet"
            type="text"
            required
            spellCheck={false}
            autoComplete="off"
            placeholder="G…"
            value={wallet}
            onChange={(event) => {
              setWalletEdited(true);
              setWallet(event.target.value.trim());
            }}
            onBlur={() => markTouched('wallet')}
            aria-invalid={walletError !== null}
            aria-describedby={[walletError ? `${ids}-wallet-error` : null, `${ids}-wallet-hint`]
              .filter(Boolean)
              .join(' ')}
            className={fieldClass}
          />
          {walletError ? (
            <p id={`${ids}-wallet-error`} className="mt-1 font-mono text-[11px] text-denied">
              {walletError}
            </p>
          ) : null}
          <p id={`${ids}-wallet-hint`} className="mt-1 font-mono text-[11px] text-faint">
            {prefilled
              ? 'From your connected wallet — edit it if you want to register a different account.'
              : 'Connect a wallet anywhere on the site to autofill this, or paste a testnet account id.'}
          </p>

          <span className={cn(labelClass, 'mt-4')}>Rating (optional)</span>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((value) => {
              const filled = value <= rating;
              return (
                <button
                  key={value}
                  type="button"
                  aria-label={`Rate ${value} of 5`}
                  onClick={() => setRating(value)}
                  className={cn(
                    'text-2xl leading-none transition-colors',
                    filled ? 'text-cyan' : 'text-faint',
                    focusRing,
                  )}
                >
                  {filled ? '★' : '☆'}
                </button>
              );
            })}
          </div>

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
            aria-describedby={noteError ? `${ids}-note-error` : undefined}
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
            <span className={cn('shrink-0 text-faint', noteOver && 'text-denied')}>
              {note.length}/{MAX_NOTE}
            </span>
          </div>

          <button
            type="submit"
            disabled={disabled}
            className={cn(
              'mt-4 w-full bg-violet px-4 py-3 font-mono text-xs uppercase tracking-[0.1em] text-white transition-colors hover:bg-violet-bright disabled:cursor-not-allowed disabled:opacity-50',
              focusRing,
            )}
          >
            {inFlight ? 'Registering…' : 'Join the testnet programme'}
          </button>

          {status === 'error' && error ? (
            <p role="alert" className="mt-2 font-mono text-xs text-denied">
              {error}
            </p>
          ) : null}
        </form>

        <p className="mt-4 max-w-[520px] text-[12px] leading-relaxed text-faint">
          Your email is used only to contact you about the Zentra testnet
          programme. It is never displayed publicly, never shown alongside your
          wallet, and never sold or shared.
        </p>
      </div>
    </HudPanel>
  );
}
