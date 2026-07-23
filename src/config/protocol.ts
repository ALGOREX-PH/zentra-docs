/**
 * Single source of truth for live protocol facts (PRD §16).
 *
 * Every surface — the landing badge, Quickstart, the playground, and reference
 * notes — reads the contract id, asset, RPC and budget from here. Updating this
 * file on a redeploy is the only change needed to keep the whole site current,
 * so no contract id is ever hardcoded in prose.
 *
 * Canonical contract id = the demo default in
 * `examples/vendor-payment-agent/demo.ts`. (The protocol README still shows an
 * older id; this is the value to reconcile to.)
 *
 * The network here is deliberately NOT derived from `src/config/network.ts`.
 * These are facts about where the ZentraVerifier is actually deployed — the
 * testnet — and they stay true whatever network the dApp itself is pointed at.
 * Switching the app to mainnet does not move this contract, so making these
 * values dynamic would turn correct documentation into a broken link.
 */
export const protocol = {
  network: 'testnet',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',

  /** The live ZentraVerifier contract on Stellar testnet. */
  contractId: 'CDS6BURFWRTU6FXN6IXOSKOIAZ4PX7XJ6U5FSI345XX3O5FGP7U3K7VY',

  /** The demo settles in native XLM via its Stellar Asset Contract. */
  asset: 'XLM',
  assetNote: 'native XLM Stellar Asset Contract',

  /** Measured cost of on-chain Groth16 verification on testnet. */
  cpuBudget: '~26M / 100M',

  /** A real settled Panel-A transaction hash (seeded once fixtures are captured). */
  samplePanelTxHash: null as string | null,

  /** Tooling pins surfaced throughout the docs. */
  tooling: {
    circom: '2.2.3',
    snarkjs: '0.7.6',
    sorobanSdk: '26.1.0',
    circomlib: '2.0.5',
    circomlibjs: '0.1.7',
    stellarSdk: '15.1.0',
  },
};

const EXPLORER = 'https://stellar.expert/explorer/testnet';

/** The verifier contract on Stellar Expert. */
export const stellarExpertContractUrl = `${EXPLORER}/contract/${protocol.contractId}`;

/** Link a settled transaction on Stellar Expert. */
export function stellarExpertTxUrl(hash: string): string {
  return `${EXPLORER}/tx/${hash}`;
}
