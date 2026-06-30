import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { WalletProvider } from '@/components/app/wallet-provider';

export const metadata: Metadata = {
  title: 'Metrics & Feedback',
  description:
    'Live on-chain usage for the Zentra dApp — actions, distinct wallets — plus product feedback collected on-chain and in Postgres.',
};

/** Scopes the wallet context to the metrics route (on-chain feedback signing). */
export default function MetricsLayout({ children }: { children: ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}
