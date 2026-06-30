'use client';

import { useState } from 'react';
import { useWallet } from '@/components/app/wallet-provider';
import { buildFeedbackXdr } from '@/lib/stellar/feedback';
import { submitInvoke } from '@/lib/stellar/action-log';
import { describeError } from '@/lib/stellar/errors';
import { HudPanel, Eyebrow } from '@/components/landing/primitives';
import { cn } from '@/lib/cn';

const MAX = 280;

type Status = 'idle' | 'sending' | 'success' | 'error';

export function FeedbackForm({ onSubmitted }: { onSubmitted?: () => void }) {
  const { address, signTransaction } = useWallet();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  const inFlight = status === 'sending';
  const over = comment.length > MAX;
  const disabled = inFlight || rating < 1 || comment.trim().length === 0 || over;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = comment.trim();
    if (rating < 1 || !trimmed || trimmed.length > MAX) {
      setStatus('error');
      setError('Pick a rating (1–5) and a comment up to 280 characters.');
      return;
    }

    setStatus('sending');
    setError(null);

    try {
      let txHash: string | null = null;
      let onChain = false;

      if (address) {
        const xdr = await buildFeedbackXdr(address, rating, trimmed);
        const signed = await signTransaction(xdr);
        txHash = await submitInvoke(signed);
        onChain = true;
      }

      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rating, comment: trimmed, wallet: address, txHash, onChain }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Could not save feedback.');
      }

      setStatus('success');
      setRating(0);
      setComment('');
      onSubmitted?.();
    } catch (err: unknown) {
      setStatus('error');
      setError(describeError(err));
    }
  }

  return (
    <HudPanel accent="violet">
      <div className="p-5 sm:p-6">
        <Eyebrow>LEAVE FEEDBACK</Eyebrow>
        <p className="mt-2 font-mono text-[11px] text-muted">
          Connect a wallet to anchor your feedback on-chain — otherwise it&apos;s saved off-chain.
        </p>

        <form onSubmit={handleSubmit} className="mt-4">
          <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.08em] text-faint">
            Rating
          </span>
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
                  )}
                >
                  {filled ? '★' : '☆'}
                </button>
              );
            })}
          </div>

          <label
            htmlFor="feedback-comment"
            className="mb-1.5 mt-4 block font-mono text-[11px] uppercase tracking-[0.08em] text-faint"
          >
            Comment
          </label>
          <textarea
            id="feedback-comment"
            rows={3}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="What worked, what didn't…"
            className="w-full resize-none border border-fd-border bg-abyss px-3 py-2.5 font-mono text-sm text-text placeholder:text-faint outline-none transition-colors focus:border-violet/60"
          />

          <div className="mt-1 flex justify-end font-mono text-[11px]">
            <span className={cn('text-faint', over && 'text-denied')}>
              {comment.length}/280
            </span>
          </div>

          <button
            type="submit"
            disabled={disabled}
            className="mt-4 w-full bg-violet px-4 py-3 font-mono text-xs uppercase tracking-[0.1em] text-white transition-colors hover:bg-[#8b5cf6] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {inFlight ? 'Sending…' : 'Send feedback'}
          </button>

          {status === 'success' && (
            <p className="mt-2 font-mono text-xs text-live">
              Thanks — your feedback was recorded.
            </p>
          )}

          {status === 'error' && error && (
            <p className="mt-2 font-mono text-xs text-denied">{error}</p>
          )}
        </form>
      </div>
    </HudPanel>
  );
}
