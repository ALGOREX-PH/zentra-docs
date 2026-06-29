import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { WalletProvider } from '@/components/app/wallet-provider';

export const metadata: Metadata = {
  title: 'Action Board',
  description:
    'Record verifiable actions to a Soroban contract on Stellar testnet and watch them stream into a live, multi-wallet on-chain feed.',
};

/** Scopes the wallet context to the Action Board route. */
export default function BoardLayout({ children }: { children: ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}
