import type { ReactNode } from 'react';
import { WalletProvider } from '@/components/app/wallet-provider';

/** Scopes the wallet context to the playground (anchoring proofs on-chain). */
export default function PlaygroundLayout({ children }: { children: ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}
