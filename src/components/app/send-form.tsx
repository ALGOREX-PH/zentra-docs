'use client';

import { useState } from 'react';
import { TxStatus } from '@/components/app/tx-status';
import { useTxPipeline } from '@/components/app/use-tx-pipeline';
import { useWallet } from '@/components/app/wallet-provider';
import { Eyebrow, HudPanel } from '@/components/landing/primitives';
import { cn } from '@/lib/cn';
import { isValidAmount, isValidPublicKey } from '@/lib/stellar/format';
import { buildPaymentXdr, submitSignedXdr } from '@/lib/stellar/payment';
import { focusRing } from '@/lib/ui';

export function SendForm({ onPaid }: { onPaid?: () => void }) {
  const { address } = useWallet();
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const { tx, run, fail, inFlight } = useTxPipeline();

  const destValid = isValidPublicKey(destination);
  const amountValid = isValidAmount(amount);
  const showDestHint = destination.length > 0 && !destValid;
  const showAmountHint = amount.length > 0 && !amountValid;
  const disabled = inFlight || !address || !destValid || !amountValid;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // The button disables while in flight, but a form can still be submitted
    // by Enter or a double-click racing the re-render. The pipeline refuses to
    // start a second run on its own; returning here as well keeps a blocked
    // resubmit from falling through to the validation errors below and
    // overwriting the in-flight status.
    if (inFlight) return;

    if (!address) {
      fail('Connect your wallet first.');
      return;
    }
    if (!destValid || !amountValid) {
      fail('Fix the highlighted fields.');
      return;
    }

    // The pipeline owns phases, error mapping and the timeout-hash passthrough;
    // this form contributes only its two steps and what a success says.
    const result = await run(
      () => buildPaymentXdr(address, destination.trim(), amount.trim()),
      async (signed) => {
        const res = await submitSignedXdr(signed);
        return { hash: res.hash, message: `Sent ${amount} XLM.` };
      },
    );

    if (result) {
      // Clearing the amount makes a repeat send a deliberate re-entry, not a
      // second Enter on a form still primed with the last payment.
      setAmount('');
      onPaid?.();
    }
  }

  return (
    <HudPanel accent="violet">
      <div className="p-5 sm:p-6">
        <Eyebrow accent="violet">SEND XLM</Eyebrow>
        <p id="send-help" className="mt-2 font-mono text-[11px] text-muted">
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
              aria-invalid={showDestHint}
              aria-describedby={[showDestHint ? 'send-destination-error' : null, 'send-help']
                .filter(Boolean)
                .join(' ')}
              className={cn(
                'w-full border border-fd-border bg-abyss px-3 py-2.5 font-mono text-sm text-text placeholder:text-faint transition-colors focus:border-violet/60',
                focusRing,
              )}
            />
            {showDestHint ? (
              <p id="send-destination-error" className="mt-1 font-mono text-[11px] text-denied">
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
              aria-invalid={showAmountHint}
              aria-describedby={[showAmountHint ? 'send-amount-error' : null, 'send-amount-hint']
                .filter(Boolean)
                .join(' ')}
              className={cn(
                'w-full border border-fd-border bg-abyss px-3 py-2.5 font-mono text-sm text-text placeholder:text-faint transition-colors focus:border-violet/60',
                focusRing,
              )}
            />
            {showAmountHint ? (
              <p id="send-amount-error" className="mt-1 font-mono text-[11px] text-denied">
                Enter a positive amount (max 7 decimals)
              </p>
            ) : null}
            <p id="send-amount-hint" className="mt-1 font-mono text-[11px] text-faint">
              In XLM, up to seven decimal places.
            </p>
          </div>

          <button
            type="submit"
            disabled={disabled}
            className={cn(
              'w-full bg-violet px-4 py-3 font-mono text-xs uppercase tracking-[0.1em] text-white transition-colors hover:bg-[#8b5cf6] disabled:cursor-not-allowed disabled:opacity-50',
              focusRing,
            )}
          >
            {inFlight ? 'Sending…' : 'Send XLM'}
          </button>

          {!address ? (
            <p className="font-mono text-[11px] text-faint">Connect your wallet to send.</p>
          ) : null}

          <div className="mt-4">
            <TxStatus state={tx} />
          </div>
        </form>
      </div>
    </HudPanel>
  );
}
