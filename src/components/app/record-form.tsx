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

export function RecordForm({ onRecorded }: { onRecorded?: () => void }) {
  const { address, signTransaction } = useWallet();
  const [message, setMessage] = useState('');
  const [tx, setTx] = useState<TxState>({ phase: 'idle' });

  const trimmed = message.trim();
  const valid = trimmed.length > 0 && message.length <= MAX;
  const inFlight =
    tx.phase === 'building' || tx.phase === 'signing' || tx.phase === 'submitting';

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

      setTx({ phase: 'success', hash, message: 'Action recorded on-chain.' });
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
        <p className="mt-2 font-mono text-[11px] text-muted">
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
            className="w-full resize-none border border-fd-border bg-abyss px-3 py-2.5 font-mono text-sm text-text placeholder:text-faint outline-none transition-colors focus:border-violet/60"
          />

          <div className="mt-1 flex justify-end font-mono text-[11px]">
            <span className={cn('text-faint', message.length > MAX && 'text-denied')}>
              {message.length}/200
            </span>
          </div>

          <button
            type="submit"
            disabled={inFlight || !address || !valid}
            className="mt-4 w-full bg-violet px-4 py-3 font-mono text-xs uppercase tracking-[0.1em] text-white transition-colors hover:bg-[#8b5cf6] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {inFlight ? 'Recording…' : 'Record on-chain'}
          </button>

          {!address && (
            <p className="mt-2 font-mono text-[11px] text-muted">
              Connect a wallet to record.
            </p>
          )}

          <div className="mt-4">
            <TxStatus state={tx} />
          </div>
        </form>
      </div>
    </HudPanel>
  );
}
