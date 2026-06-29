/**
 * The deployed Zentra Action Log contract (Soroban, Stellar testnet).
 *
 * `contractId` is the single source the dApp reads from. `readSource` is a
 * funded testnet account used only to *simulate* the read-only calls
 * (`get_count` / `get_recent`) — reads never sign or submit, so any existing
 * account serves as the simulation source.
 */
export const actionLog = {
  contractId: 'CDDIQNNCZ23UVM4FTEKNFUB72WHNASWOX2JRXED3HYK6FNZGZCHBQFK7',
  /** Ledger of the first recorded action — a floor for event history. */
  deployLedger: 3346663,
  /** Funded testnet account used purely as the source for read simulations. */
  readSource: 'GDUY4FYOA7C5FF45OL5HN2IMVE5CDXO2DZZQNKQXVVDRNCXOSDRHY7LO',
} as const;
