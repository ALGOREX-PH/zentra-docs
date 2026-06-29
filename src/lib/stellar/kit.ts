import { Networks, StellarWalletsKit } from '@creit.tech/stellar-wallets-kit';
import {
  FreighterModule,
  FREIGHTER_ID,
} from '@creit.tech/stellar-wallets-kit/modules/freighter';

/**
 * Initialise the Stellar Wallets Kit once, for testnet with Freighter.
 *
 * v2.4 exposes the kit as a static singleton: `init()` runs a single time in the
 * browser, then every call site uses the static methods. Guarded so it never
 * runs during SSR (the kit reaches for `window`) and never re-initialises.
 */
let initialised = false;

export function getKit(): typeof StellarWalletsKit {
  if (typeof window === 'undefined') {
    throw new Error('Wallet kit is only available in the browser.');
  }
  if (!initialised) {
    StellarWalletsKit.init({
      network: Networks.TESTNET,
      selectedWalletId: FREIGHTER_ID,
      modules: [new FreighterModule()],
    });
    initialised = true;
  }
  return StellarWalletsKit;
}
