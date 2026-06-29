import { stellar } from '@/config/stellar';
import { horizon } from './client';

/**
 * Native XLM balance for an account.
 *
 * Returns `null` (not "0") when the account does not exist on testnet yet — an
 * unfunded account 404s on Horizon, and the UI treats "not created" differently
 * from "created with a zero balance".
 */
export async function getXlmBalance(address: string): Promise<string | null> {
  try {
    const account = await horizon.loadAccount(address);
    const native = account.balances.find((b) => b.asset_type === 'native');
    return native?.balance ?? '0';
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/**
 * Fund a testnet account from Friendbot — covers the "fund your wallet" step.
 *
 * Friendbot creates and seeds a new testnet account with lumens. If the account
 * already exists it answers with an `op_already_exists`-style error, which we
 * treat as success rather than surfacing as a failure.
 */
export async function fundWithFriendbot(address: string): Promise<void> {
  const res = await fetch(
    `${stellar.friendbotUrl}/?addr=${encodeURIComponent(address)}`,
  );
  if (res.ok) return;

  const body = await res.text().catch(() => '');
  if (body.includes('op_already_exists') || body.includes('AlreadyExist')) return;
  throw new Error('Friendbot could not fund this account. It may already be funded.');
}

/** Horizon raises a 404-shaped error when an account has never been created. */
function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'response' in err &&
    (err as { response?: { status?: number } }).response?.status === 404
  );
}
