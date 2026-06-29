import { Horizon } from '@stellar/stellar-sdk';
import { stellar } from '@/config/stellar';

/**
 * One Horizon client for the whole dApp, pinned to testnet.
 *
 * Horizon (not RPC) is the right surface here: classic XLM payments, account
 * balances, and transaction history all live on Horizon's REST API, and
 * `horizon-testnet.stellar.org` serves CORS so it can be called from the browser.
 */
export const horizon = new Horizon.Server(stellar.horizonUrl);
