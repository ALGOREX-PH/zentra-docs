'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { ISupportedWallet } from '@creit.tech/stellar-wallets-kit';
import { useWallet } from '@/components/app/wallet-provider';
import { truncateAddress } from '@/lib/stellar/format';
import { getKit } from '@/lib/stellar/kit';
import { stellar } from '@/config/stellar';
import { cn } from '@/lib/cn';

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan';

export function ConnectButton() {
  const { address, connecting, connect, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const [wallets, setWallets] = useState<ISupportedWallet[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const titleId = useId();
  const descriptionId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  // Whether a connection attempt is in flight, so the result can be read off
  // `connecting` falling back to false rather than from a stale closure.
  const attempting = useRef(false);

  // The kit reports availability by probing each module, so the list is only
  // worth reading once the dialog is actually open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setListError(null);
    getKit()
      .refreshSupportedWallets()
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
    if (connecting) {
      attempting.current = true;
      return;
    }
    if (!attempting.current) return;
    attempting.current = false;
    setPending(null);
    if (address) {
      setOpen(false);
      return;
    }
    // The provider swallows a decline so the rest of the dApp stays
    // disconnected quietly; the picker is the one place that should say so.
    setFailed(
      'Could not connect. Check the wallet is installed, unlocked, and set to testnet.',
    );
  }, [connecting, address]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  function choose(walletId: string) {
    setFailed(null);
    setPending(walletId);
    void connect(walletId);
  }

  const dialog = open ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-void/80 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
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
                  {wallet.isAvailable ? (
                    <button
                      type="button"
                      onClick={() => choose(wallet.id)}
                      disabled={connecting}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 px-4 py-3 text-left font-mono text-sm text-text transition-colors hover:bg-violet/[0.07] disabled:cursor-not-allowed disabled:opacity-50',
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
        href={stellar.explorerAccountUrl(address)}
        target="_blank"
        rel="noreferrer"
        title={`View ${address} on stellar.expert`}
        aria-label={`View connected account ${truncateAddress(address)} on the block explorer`}
        className={cn(
          'inline-flex items-center gap-2 border border-violet/40 bg-violet/[0.07] px-3 py-2 font-mono text-xs text-violet-soft transition-colors hover:border-cyan/40 hover:text-cyan',
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
        )}
      >
        Disconnect
      </button>
    </div>
  );
}
