import {
  FreighterModule,
  FREIGHTER_ID,
  StellarWalletsKit,
  type WalletNetwork,
} from '@creit.tech/stellar-wallets-kit';
import { stellar } from '@/config/stellar';

/**
 * The Stellar Wallets Kit singleton, configured for testnet with Freighter.
 *
 * Built lazily and only in the browser — the kit reaches for `window`, so it
 * must never be constructed during SSR. Every caller shares the one instance so
 * the selected wallet and signing context stay consistent.
 */
let kit: StellarWalletsKit | null = null;

export function getKit(): StellarWalletsKit {
  if (typeof window === 'undefined') {
    throw new Error('Wallet kit is only available in the browser.');
  }
  if (!kit) {
    kit = new StellarWalletsKit({
      network: stellar.walletNetwork as WalletNetwork,
      selectedWalletId: FREIGHTER_ID,
      modules: [new FreighterModule()],
    });
  }
  return kit;
}
