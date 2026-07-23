import { Networks } from '@stellar/stellar-sdk';

/**
 * The one module that knows which chain the app talks to.
 *
 * Every endpoint, passphrase and explorer link in the dApp is derived from the
 * profile selected here, so moving to mainnet is a deploy-time decision — set
 * `NEXT_PUBLIC_STELLAR_NETWORK` in the environment — rather than a code change.
 * Nothing else in `src/` should name a network or hardcode a Horizon/RPC host.
 */

/** The two chains the app can be pointed at, named as the SDK names them. */
export type StellarNetwork = 'testnet' | 'public';

/** Everything that differs between chains, resolved once per deployment. */
export interface NetworkProfile {
  network: StellarNetwork;
  label: string;
  horizonUrl: string;
  rpcUrl: string;
  networkPassphrase: string;
  /** Friendbot exists only on testnet. */
  friendbotUrl: string | null;
  /** stellar.expert path segment: 'testnet' | 'public'. */
  explorerSegment: string;
}

/** The environment variable that selects the profile. */
export const NETWORK_ENV = 'NEXT_PUBLIC_STELLAR_NETWORK';

/** The endpoint set for each chain. Passphrases come from the SDK, never typed by hand. */
export const PROFILES: Record<StellarNetwork, NetworkProfile> = {
  testnet: {
    network: 'testnet',
    label: 'Testnet',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: Networks.TESTNET,
    friendbotUrl: 'https://friendbot.stellar.org',
    explorerSegment: 'testnet',
  },
  public: {
    network: 'public',
    label: 'Mainnet',
    horizonUrl: 'https://horizon.stellar.org',
    rpcUrl: 'https://mainnet.sorobanrpc.com',
    networkPassphrase: Networks.PUBLIC,
    // No Friendbot on mainnet: lumens there are bought, not handed out.
    friendbotUrl: null,
    explorerSegment: 'public',
  },
};

/**
 * Read a raw environment value into a network, case-insensitively and trimmed.
 *
 * Accepts the canonical `testnet` and `public`, plus `mainnet` and `pubnet` as
 * conveniences for the names people actually type. Never throws.
 */
export function resolveNetwork(raw: string | undefined): StellarNetwork {
  switch (raw?.trim().toLowerCase()) {
    case 'public':
    case 'mainnet':
    case 'pubnet':
      return 'public';
    case 'testnet':
      return 'testnet';
    default:
      // An unrecognised value must fail safe toward the network where mistakes
      // are free, so anything unrecognised or absent returns 'testnet'. A typo
      // in an environment variable must never silently point the app at real
      // funds.
      return 'testnet';
  }
}

/**
 * The chain this build talks to.
 *
 * The lookup is written out as the literal `process.env.NEXT_PUBLIC_STELLAR_NETWORK`
 * on purpose. Next.js inlines `NEXT_PUBLIC_*` variables into the client bundle at
 * build time by matching that exact text, so a computed lookup — `process.env[NETWORK_ENV]`
 * — is left untouched by the compiler and silently evaluates to `undefined` in the
 * browser. `NETWORK_ENV` is exported for documentation and tooling, not for reading.
 */
export const activeNetwork: StellarNetwork = resolveNetwork(
  process.env.NEXT_PUBLIC_STELLAR_NETWORK,
);

/** The endpoints for `activeNetwork` — what the rest of the app should import. */
export const activeProfile: NetworkProfile = PROFILES[activeNetwork];

/** Whether this build is pointed at real funds. Guard anything irreversible with it. */
export const isMainnet: boolean = activeNetwork === 'public';
