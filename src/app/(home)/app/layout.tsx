import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { WalletProvider } from '@/components/app/wallet-provider';

export const metadata: Metadata = {
  title: 'Testnet App',
  description:
    'Connect Freighter, check your XLM balance, and send a payment on the Stellar testnet — the hands-on foundation Zentra Protocol builds on.',
};

/** Scopes the wallet context to the dApp route so docs pages stay wallet-free. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}
