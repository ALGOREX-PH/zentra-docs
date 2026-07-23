import { Networks, StellarWalletsKit } from '@creit.tech/stellar-wallets-kit';
import {
  FreighterModule,
  FREIGHTER_ID,
} from '@creit.tech/stellar-wallets-kit/modules/freighter';
import { xBullModule } from '@creit.tech/stellar-wallets-kit/modules/xbull';
import { AlbedoModule } from '@creit.tech/stellar-wallets-kit/modules/albedo';
import { LobstrModule } from '@creit.tech/stellar-wallets-kit/modules/lobstr';
import { HanaModule } from '@creit.tech/stellar-wallets-kit/modules/hana';
import { RabetModule } from '@creit.tech/stellar-wallets-kit/modules/rabet';
import { activeNetwork } from '@/config/network';

/**
 * The kit ships its own network enum, distinct from the SDK's `Networks`.
 *
 * Mapping it off `activeNetwork` keeps this the single place the two
 * vocabularies meet. Without it a mainnet cutover would need a code change in
 * the wallet layer as well as a configuration change — precisely what
 * `src/config/network.ts` exists to prevent.
 */
const KIT_NETWORK = activeNetwork === 'public' ? Networks.PUBLIC : Networks.TESTNET;

/**
 * Initialise the Stellar Wallets Kit once, for the active network with Freighter.
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
      network: KIT_NETWORK,
      selectedWalletId: FREIGHTER_ID,
      modules: [
        new FreighterModule(),
        new xBullModule(),
        new AlbedoModule(),
        new LobstrModule(),
        new HanaModule(),
        new RabetModule(),
      ],
    });
    initialised = true;
  }
  return StellarWalletsKit;
}
