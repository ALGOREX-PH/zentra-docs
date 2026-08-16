import { activeNetwork } from '@/config/network';

/**
 * Freighter's module id, mirrored from the kit.
 *
 * The kit exports this constant from its Freighter module, but importing it
 * from there would pull `@stellar/freighter-api` — and with it the whole kit
 * stack — into every bundle that only wants the id string. The value is the
 * module's stable product id (`'freighter'`), part of the kit's public API, so
 * mirroring it here keeps the kit itself out of the first-load bundle.
 */
export const FREIGHTER_ID = 'freighter';

/**
 * Re-exported so components can type the wallet list without importing the kit
 * package themselves — a type-only import is erased at compile time, but
 * keeping every reference to the package inside this module makes "nothing
 * imports the kit eagerly" a one-file property instead of a repo-wide audit.
 */
export type { ISupportedWallet } from '@creit.tech/stellar-wallets-kit';

/**
 * The kit's static class, named via a type-only lookup so this module has no
 * runtime import of the package at all.
 */
export type WalletKit = typeof import('@creit.tech/stellar-wallets-kit').StellarWalletsKit;

/**
 * The one in-flight (or settled) load of the kit. Memoised so the dynamic
 * imports and `init()` run once per session no matter how many call sites ask.
 */
let kitPromise: Promise<WalletKit> | null = null;

/**
 * Load and initialise the Stellar Wallets Kit on demand.
 *
 * The kit barrel plus six wallet modules weigh far too much to ship in the
 * first-load bundle of every page that mounts `WalletProvider`, so everything
 * is pulled in with dynamic `import()` the first time something actually needs
 * a wallet — reconnecting a persisted session, opening the picker, signing.
 * Until then the kit contributes nothing to the page.
 *
 * v2.4 exposes the kit as a static singleton: `init()` runs a single time in
 * the browser, then every call site uses the static methods. Guarded so it
 * never runs during SSR (the kit reaches for `window`). A failed load — a
 * dropped chunk on a flaky connection — clears the memo so the next call can
 * retry instead of replaying a cached rejection forever.
 */
export function getKit(): Promise<WalletKit> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Wallet kit is only available in the browser.'));
  }
  kitPromise ??= (async () => {
    const [core, freighter, xbull, albedo, lobstr, hana, rabet] = await Promise.all([
      import('@creit.tech/stellar-wallets-kit'),
      import('@creit.tech/stellar-wallets-kit/modules/freighter'),
      import('@creit.tech/stellar-wallets-kit/modules/xbull'),
      import('@creit.tech/stellar-wallets-kit/modules/albedo'),
      import('@creit.tech/stellar-wallets-kit/modules/lobstr'),
      import('@creit.tech/stellar-wallets-kit/modules/hana'),
      import('@creit.tech/stellar-wallets-kit/modules/rabet'),
    ]);

    /*
     * The kit ships its own network enum, distinct from the SDK's `Networks`.
     * Mapping it off `activeNetwork` keeps this the single place the two
     * vocabularies meet, so a mainnet cutover stays a configuration change in
     * `src/config/network.ts` rather than an edit to the wallet layer.
     */
    core.StellarWalletsKit.init({
      network: activeNetwork === 'public' ? core.Networks.PUBLIC : core.Networks.TESTNET,
      selectedWalletId: FREIGHTER_ID,
      modules: [
        new freighter.FreighterModule(),
        new xbull.xBullModule(),
        new albedo.AlbedoModule(),
        new lobstr.LobstrModule(),
        new hana.HanaModule(),
        new rabet.RabetModule(),
      ],
    });
    return core.StellarWalletsKit;
  })().catch((cause: unknown) => {
    kitPromise = null;
    throw cause;
  });
  return kitPromise;
}
