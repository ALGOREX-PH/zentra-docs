/**
 * Turn a thrown wallet/Horizon error into a short, human-readable message.
 *
 * Two failure shapes dominate this dApp: the user declining the signature in
 * their wallet, and Horizon rejecting the submission with structured
 * `result_codes`. Everything else falls back to the raw message.
 */
export function describeError(err: unknown): string {
  const msg = errorMessage(err);
  if (/reject|denied|declined|cancel/i.test(msg)) {
    return 'You declined the signature in your wallet.';
  }

  const codes = horizonResultCodes(err);
  if (codes) {
    if (codes.transaction === 'tx_insufficient_balance') {
      return 'Not enough XLM to cover the amount plus the network fee.';
    }
    if (codes.operations?.includes('op_no_destination')) {
      return 'The destination account does not exist on testnet — fund it first.';
    }
    if (codes.operations?.includes('op_underfunded')) {
      return 'Not enough XLM in your account for this payment.';
    }
    if (codes.transaction === 'tx_bad_seq') {
      return 'The transaction sequence was stale. Please try again.';
    }
    return `Network rejected the transaction (${codes.transaction ?? 'unknown'}).`;
  }

  return msg || 'Something went wrong. Please try again.';
}

function errorMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message?: unknown }).message ?? '');
  }
  return '';
}

interface ResultCodes {
  transaction?: string;
  operations?: string[];
}

/** Horizon attaches `result_codes` under `response.data.extras` on a 400. */
function horizonResultCodes(err: unknown): ResultCodes | null {
  const extras = (
    err as {
      response?: { data?: { extras?: { result_codes?: ResultCodes } } };
    }
  )?.response?.data?.extras;
  return extras?.result_codes ?? null;
}
