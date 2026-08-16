'use client';

import { useState } from 'react';
import { useWallet } from '@/components/app/wallet-provider';
import { buildFeedbackXdr } from '@/lib/stellar/feedback';
import { submitInvoke } from '@/lib/stellar/action-log';
import { describeError } from '@/lib/stellar/errors';
import { readApiError } from '@/lib/api/client';
import { stellar } from '@/config/stellar';
import { truncateAddress } from '@/lib/stellar/format';
import { HudPanel, Eyebrow } from '@/components/landing/primitives';
import { inFlightLabels } from '@/components/app/tx-status';
import { StarRating } from '@/components/app/star-rating';
import { focusRing } from '@/lib/ui';
import { cn } from '@/lib/cn';

const MAX = 280;

type Status = 'idle' | 'sending' | 'success' | 'error';

/**
 * The on-chain leg that already settled when the save to the API failed.
 *
 * The whole payload is frozen here, not just the hash: the retry must POST
 * exactly what the chain recorded — same wallet, same rating, same comment —
 * even if the fields have changed or the wallet has disconnected since.
 * A settled anchor means a retry never builds or signs a second transaction.
 */
interface Anchor {
  txHash: string;
  wallet: string;
  rating: number;
  comment: string;
}

export function FeedbackForm({ onSubmitted }: { onSubmitted?: () => void }) {
  const { address, signTransaction } = useWallet();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [anchored, setAnchored] = useState<Anchor | null>(null);
  // What the in-flight leg is doing right now, in TxStatus's exact words.
  // This form runs its own pipeline (the anchored retry must skip build, sign
  // and submit, which the shared hook never does), so it borrows the shared
  // vocabulary instead of the shared machinery: without this, "awaiting
  // signature" — the moment the user must look at their wallet — was a button
  // caption change no screen reader would report.
  const [note, setNote] = useState('');

  const inFlight = status === 'sending';
  const over = comment.length > MAX;
  // An anchored retry submits the frozen payload, so the live fields no longer
  // gate the button — only the in-flight lock does.
  const disabled =
    inFlight || (anchored === null && (rating < 1 || comment.trim().length === 0 || over));

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // The button disables while sending, but Enter and a double-click racing
    // the re-render can still submit — and a duplicate submission would sign
    // and record a duplicate on-chain transaction.
    if (inFlight) return;

    const trimmed = comment.trim();
    if (!anchored && (rating < 1 || !trimmed || trimmed.length > MAX)) {
      setStatus('error');
      setError(`Pick a rating (1–5) and a comment up to ${MAX} characters.`);
      return;
    }

    setStatus('sending');
    setError(null);

    // Read the anchor into a local so the catch below can tell which leg
    // failed even before React commits the state update.
    let anchor = anchored;

    try {
      if (!anchor && address) {
        setNote(inFlightLabels.building);
        const xdr = await buildFeedbackXdr(address, rating, trimmed);
        setNote(inFlightLabels.signing);
        const signed = await signTransaction(xdr);
        setNote(inFlightLabels.submitting);
        const txHash = await submitInvoke(signed);
        anchor = { txHash, wallet: address, rating, comment: trimmed };
        setAnchored(anchor);
      }

      setNote('Saving feedback…');
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          anchor
            ? {
                rating: anchor.rating,
                comment: anchor.comment,
                wallet: anchor.wallet,
                txHash: anchor.txHash,
                onChain: true,
              }
            : { rating, comment: trimmed, wallet: address, txHash: null, onChain: false },
        ),
      });

      // A 409 on an anchored retry means the first POST landed after its
      // response was lost: the feedback is already saved. That is success.
      if (!res.ok && !(anchor && res.status === 409)) {
        throw new Error(await readApiError(res, 'Could not save feedback.'));
      }

      setStatus('success');
      setAnchored(null);
      setRating(0);
      setComment('');
      onSubmitted?.();
    } catch (err: unknown) {
      setStatus('error');
      // Once the anchor has settled, the only leg left to fail is the save —
      // say so, and promise that retrying will not ask for another signature.
      setError(
        anchor
          ? `Your feedback is recorded on-chain, but saving it failed (${describeError(err)}). Retrying will not ask for another signature.`
          : describeError(err),
      );
    }
  }

  return (
    <HudPanel accent="violet">
      <div className="p-5 sm:p-6">
        <Eyebrow>LEAVE FEEDBACK</Eyebrow>
        <p id="feedback-comment-help" className="mt-2 font-mono text-[11px] text-muted">
          Connect a wallet to anchor your feedback on-chain — otherwise it&apos;s saved off-chain.
        </p>

        <form onSubmit={handleSubmit} className="mt-4">
          <span
            id="feedback-rating-label"
            className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.08em] text-faint"
          >
            Rating
          </span>
          {/* Disabled while an anchor is pending, like the textarea below:
              the retry saves the frozen payload, so edits must not look live. */}
          <StarRating
            value={rating}
            onChange={setRating}
            labelledBy="feedback-rating-label"
            disabled={anchored !== null}
          />

          <label
            htmlFor="feedback-comment"
            className="mb-1.5 mt-4 block font-mono text-[11px] uppercase tracking-[0.08em] text-faint"
          >
            Comment
          </label>
          {/*
            The fields lock while an anchor is pending so nothing typed after
            the on-chain leg settled can be silently dropped: the retry saves
            the frozen payload, and an editable field would suggest otherwise.
          */}
          <textarea
            id="feedback-comment"
            rows={3}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="What worked, what didn't…"
            disabled={anchored !== null}
            aria-invalid={over}
            aria-describedby={[
              'feedback-comment-help',
              'feedback-comment-count',
              over ? 'feedback-comment-error' : null,
            ]
              .filter(Boolean)
              .join(' ')}
            className={cn(
              'w-full resize-none border border-fd-border bg-abyss px-3 py-2.5 font-mono text-sm text-text placeholder:text-faint transition-colors focus:border-violet/60',
              focusRing,
            )}
          />

          <div className="mt-1 flex items-start justify-between gap-3 font-mono text-[11px]">
            {over ? (
              <p id="feedback-comment-error" className="text-denied">
                Comment must be {MAX} characters or fewer.
              </p>
            ) : (
              <span />
            )}
            <span
              id="feedback-comment-count"
              className={cn('shrink-0 text-faint', over && 'text-denied')}
            >
              {comment.length}/{MAX}
            </span>
          </div>

          <button
            type="submit"
            disabled={disabled}
            className={cn(
              'mt-4 w-full bg-violet px-4 py-3 font-mono text-xs uppercase tracking-[0.1em] text-white transition-colors hover:bg-[#8b5cf6] disabled:cursor-not-allowed disabled:opacity-50',
              focusRing,
            )}
          >
            {inFlight ? 'Sending…' : anchored ? 'Retry save' : 'Send feedback'}
          </button>

          {/*
            All three regions are mounted from the first render. A live region
            created at the same instant as its text is routinely missed, and
            this form's only feedback is these lines. The first is sr-only:
            sighted users already have the button caption, but the leg changes
            — especially "awaiting signature" — are otherwise silent.
          */}
          <p aria-live="polite" aria-atomic="true" className="sr-only">
            {status === 'sending' ? note : ''}
          </p>

          <p
            aria-live="polite"
            aria-atomic="true"
            className={cn('font-mono text-xs text-live', status === 'success' && 'mt-2')}
          >
            {status === 'success' ? 'Thanks — your feedback was recorded.' : ''}
          </p>

          <p
            role="alert"
            className={cn('font-mono text-xs text-denied', status === 'error' && error && 'mt-2')}
          >
            {status === 'error' && error ? (
              <>
                {error}
                {/* The settled transaction is real even though the save is not:
                    link it so the user can verify the anchor independently. */}
                {anchored ? (
                  <>
                    {' '}
                    <a
                      href={stellar.explorerTxUrl(anchored.txHash)}
                      target="_blank"
                      rel="noreferrer"
                      className={cn(
                        'text-cyan underline-offset-2 hover:underline',
                        focusRing,
                      )}
                    >
                      Tx {truncateAddress(anchored.txHash)}
                    </a>
                  </>
                ) : null}
              </>
            ) : (
              ''
            )}
          </p>
        </form>
      </div>
    </HudPanel>
  );
}
