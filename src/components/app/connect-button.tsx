'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useWallet } from '@/components/app/wallet-provider';
import { truncateAddress } from '@/lib/stellar/format';
import { getKit, type ISupportedWallet } from '@/lib/stellar/kit';
import { stellar } from '@/config/stellar';
import { focusRing } from '@/lib/ui';
import { cn } from '@/lib/cn';

/** Everything inside the dialog a keyboard can reach, in document order. */
const FOCUSABLE = 'a[href], button:not([disabled])';

export function ConnectButton() {
  const { address, connecting, connect, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const [wallets, setWallets] = useState<ISupportedWallet[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const titleId = useId();
  const descriptionId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const connected = useRef<HTMLAnchorElement>(null);

  // The kit reports availability by probing each module, so the list is only
  // worth reading once the dialog is actually open. Opening it is also what
  // triggers the kit's lazy download on a first visit, hence the await chain.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setListError(null);
    getKit()
      .then((kit) => kit.refreshSupportedWallets())
      .then((supported) => {
        if (!cancelled) setWallets(supported);
      })
      .catch(() => {
        if (!cancelled) setListError('Could not detect the wallets on this device.');
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  /**
   * Focus enters the dialog on open and goes back to whichever control the
   * button rendered as on close — the trigger normally, the account link when
   * the connection succeeded and took the trigger away with it.
   */
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => {
      (trigger.current ?? connected.current)?.focus();
    };
  }, [open]);

  /** Tab and Shift+Tab wrap at the ends instead of walking out of the dialog. */
  function trapFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return;
    const nodes = panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (!nodes || nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /**
   * The provider reports how the attempt ended, so the picker can answer with
   * the right sentence instead of reverse-engineering the result from state
   * transitions: a decline is the user's own doing and only needs pointing at
   * the wallet, while an unavailable wallet needs troubleshooting steps.
   */
  async function choose(walletId: string) {
    if (connecting) return;
    setFailed(null);
    setPending(walletId);
    const outcome = await connect(walletId);
    setPending(null);
    if (outcome === 'connected') {
      setOpen(false);
      return;
    }
    setFailed(
      outcome === 'declined'
        ? 'The request was declined in the wallet. Approve it there to connect.'
        : 'Could not connect. Check the wallet is installed, unlocked, and set to testnet.',
    );
  }

  const dialog = open ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-void/80 backdrop-blur-[2px]"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={trapFocus}
        className="relative w-full max-w-[400px] border border-violet/40 bg-panel"
      >
        <div className="flex items-start justify-between gap-4 border-b border-fd-border px-5 py-4">
          <div>
            <h2
              id={titleId}
              className="font-mono text-xs uppercase tracking-[0.14em] text-violet-soft"
            >
              Connect a wallet
            </h2>
            <p id={descriptionId} className="mt-1.5 font-mono text-[11px] text-muted">
              Pick a wallet to sign on the Stellar testnet.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className={cn(
              'shrink-0 border border-fd-border px-2 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted transition-colors hover:border-denied/50 hover:text-denied',
              focusRing,
            )}
          >
            Close
          </button>
        </div>

        <div className="p-5">
          {wallets === null && listError === null ? (
            <p className="font-mono text-sm text-muted">Detecting wallets…</p>
          ) : listError ? (
            <p className="font-mono text-xs text-denied">{listError}</p>
          ) : wallets !== null && wallets.length === 0 ? (
            <p className="font-mono text-sm text-muted">
              No supported wallets found. Install Freighter to get started.
            </p>
          ) : (
            <ul className="divide-y divide-fd-border border border-fd-border">
              {(wallets ?? []).map((wallet) => (
                <li key={wallet.id}>
                  {/*
                    aria-disabled, not disabled: a real `disabled` on the wallet
                    the user just activated would drop the focused element out
                    of the trap's selector mid-connection and let the next Tab
                    walk straight out of the dialog.
                  */}
                  {wallet.isAvailable ? (
                    <button
                      type="button"
                      onClick={() => void choose(wallet.id)}
                      aria-disabled={connecting}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 px-4 py-3 text-left font-mono text-sm text-text transition-colors hover:bg-violet/[0.07]',
                        connecting && 'cursor-not-allowed opacity-50',
                        focusRing,
                      )}
                    >
                      {wallet.name}
                      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-live">
                        {pending === wallet.id ? 'Connecting…' : 'Detected'}
                      </span>
                    </button>
                  ) : (
                    <a
                      href={wallet.url}
                      target="_blank"
                      rel="noreferrer"
                      className={cn(
                        'flex w-full items-center justify-between gap-3 px-4 py-3 font-mono text-sm text-muted transition-colors hover:bg-violet/[0.07] hover:text-cyan',
                        focusRing,
                      )}
                    >
                      {wallet.name}
                      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-faint">
                        Install
                      </span>
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}

          {failed ? (
            <p role="alert" className="mt-3 font-mono text-[11px] text-denied">
              {failed}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  ) : null;

  if (!address) {
    return (
      <>
        <button
          ref={trigger}
          type="button"
          onClick={() => {
            setFailed(null);
            setOpen(true);
          }}
          disabled={connecting}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Connect your Stellar wallet"
          className={cn(
            'inline-flex items-center gap-2 bg-violet px-4 py-2 font-mono text-xs uppercase tracking-[0.1em] text-white transition-colors hover:bg-[#8b5cf6] disabled:opacity-50',
            focusRing,
          )}
        >
          <span aria-hidden className="size-1.5 bg-cyan" />
          {connecting ? 'Connecting…' : 'Connect Wallet'}
        </button>
        {dialog}
      </>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <a
        ref={connected}
        href={stellar.explorerAccountUrl(address)}
        target="_blank"
        rel="noreferrer"
        title={`View ${address} on stellar.expert`}
        aria-label={`View connected account ${truncateAddress(address)} on the block explorer`}
        className={cn(
          'inline-flex items-center gap-2 border border-violet/40 bg-violet/[0.07] px-3 py-2 font-mono text-xs text-violet-soft transition-colors hover:border-cyan/40 hover:text-cyan',
          focusRing,
        )}
      >
        <span aria-hidden className="size-1.5 bg-live" />
        {truncateAddress(address)}
      </a>
      <button
        type="button"
        onClick={() => disconnect()}
        aria-label="Disconnect your Stellar wallet"
        className={cn(
          'border border-fd-border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted transition-colors hover:border-denied/50 hover:text-denied',
          focusRing,
        )}
      >
        Disconnect
      </button>
    </div>
  );
}
