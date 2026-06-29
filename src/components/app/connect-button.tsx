'use client';

import { useWallet } from '@/components/app/wallet-provider';
import { truncateAddress } from '@/lib/stellar/format';
import { stellar } from '@/config/stellar';
import { cn } from '@/lib/cn';

export function ConnectButton() {
  const { address, connecting, connect, disconnect } = useWallet();

  if (!address) {
    return (
      <button
        type="button"
        onClick={() => connect()}
        disabled={connecting}
        aria-label="Connect your Stellar wallet"
        className={cn(
          'inline-flex items-center gap-2 bg-violet px-4 py-2 font-mono text-xs uppercase tracking-[0.1em] text-white transition-colors hover:bg-[#8b5cf6] disabled:opacity-50',
        )}
      >
        <span aria-hidden className="size-1.5 bg-cyan" />
        {connecting ? 'Connecting…' : 'Connect Wallet'}
      </button>
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
