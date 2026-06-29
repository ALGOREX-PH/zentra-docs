import { Networks } from '@stellar/stellar-sdk';

/**
 * Stellar **testnet** endpoints and identifiers for the Zentra dApp.
 *
 * This is the White-Belt foundation — connect, balance, and payments run
 * against testnet only. Kept as one source so every wallet/chain call agrees
 * on the network passphrase and the explorer links resolve to the same chain.
 */
export const stellar = {
  network: 'testnet',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  friendbotUrl: 'https://friendbot.stellar.org',
  networkPassphrase: Networks.TESTNET,
  /** Stellar Expert links so users can independently verify a result on-chain. */
  explorerTxUrl: (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`,
  explorerAccountUrl: (address: string) =>
    `https://stellar.expert/explorer/testnet/account/${address}`,
} as const;
