import { rpc } from '@stellar/stellar-sdk';
import { stellar } from '@/config/stellar';

/**
 * One Soroban RPC client for the dApp, pointed at the configured network.
 *
 * RPC (not Horizon) is the contract surface: it simulates read-only calls,
 * assembles invoke transactions with the right resources, submits them, and
 * serves `getEvents` for the live action feed.
 */
export const soroban = new rpc.Server(stellar.rpcUrl);
