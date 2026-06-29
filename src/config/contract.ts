/**
 * The deployed Zentra Action Log contract (Soroban, Stellar testnet).
 *
 * `contractId` is the single source the dApp reads from. `readSource` is a
 * funded testnet account used only to *simulate* the read-only calls
 * (`get_count` / `get_recent`) — reads never sign or submit, so any existing
 * account serves as the simulation source.
 */
export const actionLog = {
  contractId: 'CCSXFTQTWVSHUMH2C64RJKY7JKCVHD5REFIW3P3YPVY6PWHVSJ7ZDDES',
  /** The reputation contract the action log bumps via a cross-contract call. */
  reputationId: 'CA2QOMGVQ5XWGFDYT5XEJ7EQ6B6H4ZNDAPS337P3BT55XY3DJY4AIIPI',
  /** Ledger of the first recorded action — a floor for event history. */
  deployLedger: 3348158,
  /** Funded testnet account used purely as the source for read simulations. */
  readSource: 'GDUY4FYOA7C5FF45OL5HN2IMVE5CDXO2DZZQNKQXVVDRNCXOSDRHY7LO',
} as const;
