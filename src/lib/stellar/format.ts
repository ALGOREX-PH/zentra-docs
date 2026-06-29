import { StrKey } from '@stellar/stellar-sdk';

/** Shorten a Stellar address for display: `GABC…WXYZ`. */
export function truncateAddress(address: string, lead = 4, tail = 4): string {
  if (address.length <= lead + tail) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

/** True when `value` is a well-formed Stellar `G...` public key. */
export function isValidPublicKey(value: string): boolean {
  return StrKey.isValidEd25519PublicKey(value.trim());
}

/** True when `value` is a positive decimal amount Stellar will accept (≤7 dp). */
export function isValidAmount(value: string): boolean {
  if (!/^\d+(\.\d{1,7})?$/.test(value.trim())) return false;
  return Number(value) > 0;
}

/** Render an XLM balance with grouping and trimmed trailing zeros. */
export function formatXlm(balance: string): string {
  const n = Number(balance);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US', { maximumFractionDigits: 7 });
}
