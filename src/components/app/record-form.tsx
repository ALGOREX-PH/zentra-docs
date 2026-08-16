'use client';

import { useState } from 'react';
import { useWallet } from '@/components/app/wallet-provider';
import { buildRecordXdr, submitInvoke } from '@/lib/stellar/action-log';
import { describeError } from '@/lib/stellar/errors';
import { HudPanel, Eyebrow } from '@/components/landing/primitives';
import { TxStatus } from '@/components/app/tx-status';
import type { TxState } from '@/lib/stellar/types';
import { cn } from '@/lib/cn';

const MAX = 200;

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan';

export function RecordForm({ onRecorded }: { onRecorded?: () => void }) {
  const { address, signTransaction } = useWallet();
  const [message, setMessage] = useState('');
  const [tx, setTx] = useState<TxState>({ phase: 'idle' });

  const trimmed = message.trim();
  const valid = trimmed.length > 0 && message.length <= MAX;
  const inFlight =
    tx.phase === 'building' || tx.phase === 'signing' || tx.phase === 'submitting';

  // An empty box is the starting state, not a mistake, so the field only reads
  // as invalid once there is something in it that the contract would refuse.
  const fieldError =
    message.length > MAX
      ? `Message must be ${MAX} characters or fewer.`
      : message.length > 0 && trimmed.length === 0
        ? 'Enter a message — whitespace on its own is not recorded.'
        : null;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!address) {
      setTx({ phase: 'error', message: 'Connect your wallet first.' });
      return;
    }

    if (!valid) {
      setTx({
        phase: 'error',
        message: 'Enter a message between 1 and 200 characters.',
      });
      return;
    }

    try {
      setTx({ phase: 'building' });
      const xdr = await buildRecordXdr(address, trimmed);

      setTx({ phase: 'signing' });
      const signed = await signTransaction(xdr);

      setTx({ phase: 'submitting' });
      const hash = await submitInvoke(signed);

      // No message line: the panel heading already says "Action recorded", so
      // a body repeating it would be read twice by the announcement below.
      setTx({ phase: 'success', hash });
      setMessage('');
      onRecorded?.();
    } catch (err: unknown) {
      setTx({ phase: 'error', message: describeError(err) });
    }
  }

  return (
    <HudPanel accent="violet">
      <div className="p-5 sm:p-6">
        <Eyebrow>RECORD AN ACTION</Eyebrow>
        <p id="record-message-help" className="mt-2 font-mono text-[11px] text-muted">
          Writes a message to the on-chain action log on Soroban (Stellar testnet).
        </p>

        <form onSubmit={handleSubmit} className="mt-4">
          <label
            htmlFor="record-message"
            className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.08em] text-faint"
          >
            Message
          </label>
          <textarea
            id="record-message"
            rows={3}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="gm from an autonomous agent…"
            aria-invalid={fieldError !== null}
            aria-describedby={[
              'record-message-help',
              'record-message-count',
              fieldError ? 'record-message-error' : null,
            ]
              .filter(Boolean)
              .join(' ')}
            className={cn(
              'w-full resize-none border border-fd-border bg-abyss px-3 py-2.5 font-mono text-sm text-text placeholder:text-faint transition-colors focus:border-violet/60',
              focusRing,
            )}
          />

          <div className="mt-1 flex items-start justify-between gap-3 font-mono text-[11px]">
            {fieldError ? (
              <p id="record-message-error" className="text-denied">
                {fieldError}
              </p>
            ) : (
              <span />
            )}
            <span
              id="record-message-count"
              className={cn('shrink-0 text-faint', message.length > MAX && 'text-denied')}
            >
              {message.length}/200
            </span>
          </div>

          <button
            type="submit"
            disabled={inFlight || !address || !valid}
            className={cn(
              'mt-4 w-full bg-violet px-4 py-3 font-mono text-xs uppercase tracking-[0.1em] text-white transition-colors hover:bg-[#8b5cf6] disabled:cursor-not-allowed disabled:opacity-50',
              focusRing,
            )}
          >
            {inFlight ? 'Recording…' : 'Record on-chain'}
          </button>

          {!address && (
            <p className="mt-2 font-mono text-[11px] text-muted">
              Connect a wallet to record.
            </p>
          )}

          <div className="mt-4">
            {/*
              This form invokes a contract; the default TxStatus copy settles a
              payment. Without these labels a recorded action was announced as
              "Payment settled" — true of nothing this form does.
            */}
            <TxStatus
              state={tx}
              labels={{
                success: 'Action recorded',
                failure: 'Recording failed',
                successAnnounce: 'Action recorded on-chain.',
              }}
            />
          </div>
        </form>
      </div>
    </HudPanel>
  );
}
