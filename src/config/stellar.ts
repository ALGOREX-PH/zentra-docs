import { activeProfile } from '@/config/network';

/**
 * Stellar endpoints and identifiers for the Zentra dApp.
 *
 * Kept as one source so every wallet/chain call agrees on the network
 * passphrase and the explorer links resolve to the same chain. The values are
 * no longer written here: they come from the profile chosen in
 * `@/config/network`, which testnet still selects by default. Point that module
 * at mainnet and every consumer of `stellar.*` follows without edits.
 */
export const stellar = {
  network: activeProfile.network,
  horizonUrl: activeProfile.horizonUrl,
  rpcUrl: activeProfile.rpcUrl,
  /**
   * Friendbot's base URL — testnet only. Empty string on mainnet, where no
   * such faucet exists; check `hasFriendbot` before offering to fund anything
   * rather than calling this and hoping.
   */
  friendbotUrl: activeProfile.friendbotUrl ?? '',
  /** Whether this network has a faucet at all. False on mainnet. */
  hasFriendbot: activeProfile.friendbotUrl !== null,
  networkPassphrase: activeProfile.networkPassphrase,
  /** Stellar Expert links so users can independently verify a result on-chain. */
  explorerTxUrl: (hash: string) =>
    `https://stellar.expert/explorer/${activeProfile.explorerSegment}/tx/${hash}`,
  explorerAccountUrl: (address: string) =>
    `https://stellar.expert/explorer/${activeProfile.explorerSegment}/account/${address}`,
  /** A contract on Stellar Expert, for any id — the ledger pages link these directly. */
  explorerContractUrl: (id: string) =>
    `https://stellar.expert/explorer/${activeProfile.explorerSegment}/contract/${id}`,
} as const;
