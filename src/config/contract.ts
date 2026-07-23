import { activeNetwork, type StellarNetwork } from '@/config/network';

/**
 * The deployed Zentra Soroban contracts, per network.
 *
 * `contractId` is the single source the dApp reads from. `readSource` is a
 * funded account used only to *simulate* the read-only calls (`get_count` /
 * `get_recent`) — reads never sign or submit, so any existing account serves as
 * the simulation source.
 *
 * Mainnet is deliberately unpopulated. Nothing is deployed to the public
 * network yet, and inventing an id here would produce links and reads that fail
 * in a way nobody could diagnose. `contractsConfigured` reports that state
 * honestly instead. Filling these in is a step in `docs/MAINNET.md`, done once
 * the contracts genuinely exist — never speculatively.
 */
interface ContractSet {
  contractId: string;
  /** The reputation contract the action log bumps via a cross-contract call. */
  reputationId: string;
  /** The feedback contract — on-chain product feedback, indexed off-chain too. */
  feedbackId: string;
  /** The proof registry — anchors each generated ZK proof's commitment on-chain. */
  proofRegistryId: string;
  /** Ledger of the first recorded action — a floor for event history. */
  deployLedger: number;
  /** Funded account used purely as the source for read simulations. */
  readSource: string;
}

const DEPLOYMENTS: Record<StellarNetwork, ContractSet> = {
  testnet: {
    contractId: 'CCSXFTQTWVSHUMH2C64RJKY7JKCVHD5REFIW3P3YPVY6PWHVSJ7ZDDES',
    reputationId: 'CA2QOMGVQ5XWGFDYT5XEJ7EQ6B6H4ZNDAPS337P3BT55XY3DJY4AIIPI',
    feedbackId: 'CC6S6CKPWKUUH6NDLAENAGBN3EBZNO4GXZ7SLIJ4O3OK2I6U6K5F4CUG',
    proofRegistryId: 'CBSGDR6WBOXHSRPDHOHY24DFHIJACY3DAK2MRRO6MLFRK7YUUBSNTSHS',
    deployLedger: 3348158,
    readSource: 'GDUY4FYOA7C5FF45OL5HN2IMVE5CDXO2DZZQNKQXVVDRNCXOSDRHY7LO',
  },
  public: {
    contractId: '',
    reputationId: '',
    feedbackId: '',
    proofRegistryId: '',
    deployLedger: 0,
    readSource: '',
  },
};

export const actionLog = DEPLOYMENTS[activeNetwork];

/**
 * Whether the active network actually has contracts deployed.
 *
 * False on mainnet until `docs/MAINNET.md` has been worked through. Check this
 * before rendering anything that would issue a contract read, so an
 * unconfigured network degrades to a clear message rather than a stack of
 * failing simulations.
 */
export const contractsConfigured = actionLog.contractId.length > 0;
