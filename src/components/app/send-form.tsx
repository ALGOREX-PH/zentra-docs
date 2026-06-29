'use client';

import { useState } from 'react';
import { useWallet } from '@/components/app/wallet-provider';
import { buildPaymentXdr, submitSignedXdr } from '@/lib/stellar/payment';
import { isValidPublicKey, isValidAmount } from '@/lib/stellar/format';
import { describeError } from '@/lib/stellar/errors';
import { HudPanel, Eyebrow } from '@/components/landing/primitives';
import { TxStatus } from '@/components/app/tx-status';
import type { TxState } from '@/lib/stellar/types';
import { cn } from '@/lib/cn';

export function SendForm({ onPaid }: { onPaid?: () => void }) {
  const { address, signTransaction } = useWallet();
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [tx, setTx] = useState<TxState>({ phase: 'idle' });

  const destValid = isValidPublicKey(destination);
  const amountValid = isValidAmount(amount);
  const showDestHint = destination.length > 0 && !destValid;
  const showAmountHint = amount.length > 0 && !amountValid;
  const inFlight =
    tx.phase === 'building' || tx.phase === 'signing' || tx.phase === 'submitting';
  const disabled = inFlight || !address || !destValid || !amountValid;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!address) {
      setTx({ phase: 'error', message: 'Connect your wallet first.' });
      return;
    }
    if (!destValid || !amountValid) {
      setTx({ phase: 'error', message: 'Fix the highlighted fields.' });
      return;
    }

    try {
      setTx({ phase: 'building' });
      const xdr = await buildPaymentXdr(address, destination.trim(), amount.trim());
      setTx({ phase: 'signing' });
      const signed = await signTransaction(xdr);
      setTx({ phase: 'submitting' });
      const res = await submitSignedXdr(signed);
      setTx({ phase: 'success', hash: res.hash, message: `Sent ${amount} XLM.` });
      onPaid?.();
    } catch (err: unknown) {
      setTx({ phase: 'error', message: describeError(err) });
    }
  }

  return (
    <HudPanel accent="violet">
      <div className="p-5 sm:p-6">
        <Eyebrow accent="violet">SEND XLM</Eyebrow>
        <p className="mt-2 font-mono text-[11px] text-muted">
          Sends native XLM on the Stellar testnet.
        </p>

        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="send-destination"
              className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.08em] text-faint"
            >
              Destination
            </label>
            <input
              id="send-destination"
              type="text"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              placeholder="G…"
              autoComplete="off"
              spellCheck={false}
              className="w-full border border-fd-border bg-abyss px-3 py-2.5 font-mono text-sm text-text placeholder:text-faint outline-none transition-colors focus:border-violet/60"
            />
            {showDestHint ? (
              <p className="mt-1 font-mono text-[11px] text-denied">
                Enter a valid G… testnet address
              </p>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="send-amount"
              className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.08em] text-faint"
            >
              Amount
            </label>
            <input
              id="send-amount"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.0"
              autoComplete="off"
              spellCheck={false}
              className="w-full border border-fd-border bg-abyss px-3 py-2.5 font-mono text-sm text-text placeholder:text-faint outline-none transition-colors focus:border-violet/60"
            />
            {showAmountHint ? (
              <p className="mt-1 font-mono text-[11px] text-denied">
                Enter a positive amount (max 7 decimals)
              </p>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={disabled}
            className={cn(
              'w-full bg-violet px-4 py-3 font-mono text-xs uppercase tracking-[0.1em] text-white transition-colors hover:bg-[#8b5cf6] disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {inFlight ? 'Sending…' : 'Send XLM'}
          </button>

          {!address ? (
            <p className="font-mono text-[11px] text-faint">
              Connect your wallet to send.
            </p>
          ) : null}

          <div className="mt-4">
            <TxStatus state={tx} />
          </div>
        </form>
      </div>
    </HudPanel>
  );
}
