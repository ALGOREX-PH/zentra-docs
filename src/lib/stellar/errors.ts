/**
 * Thrown when a submission times out with the outcome unknown: the network can
 * still apply the transaction after the connection died, so "failed" would be
 * a lie and an invitation to double-pay. Carries the client-computed hash so
 * the UI can link the explorer instead of asking the user to retry blind.
 *
 * The default copy speaks about payments; a caller submitting something else
 * (a contract invoke, say) passes its own equally honest wording.
 */
export class SubmitTimeoutError extends Error {
  constructor(
    public readonly hash: string,
    message = 'Submission timed out — the payment may still have gone through. Check the explorer before sending again.',
  ) {
    super(message);
    this.name = 'SubmitTimeoutError';
  }
}

/**
 * Thrown when the network gives a definite verdict against a Soroban invoke:
 * refused at submission, failed on-chain, or a duplicate of one already in
 * flight. Carries the transaction hash whenever one exists so the UI can
 * render the explorer link next to the failure ({@link TxState} in
 * `./types` supports `hash` on failure for exactly this).
 */
export class InvokeFailedError extends Error {
  constructor(
    message: string,
    public readonly hash?: string,
  ) {
    super(message);
    this.name = 'InvokeFailedError';
  }
}

/**
 * Turn a thrown wallet/Horizon error into a short, human-readable message.
 *
 * Two failure shapes dominate this dApp: the user declining the signature in
 * their wallet, and Horizon rejecting the submission with structured
 * `result_codes`. A {@link SubmitTimeoutError} keeps its own copy — its
 * outcome is unresolved, not failed. Everything else falls back to the raw
 * message.
 */
export function describeError(err: unknown): string {
  if (err instanceof SubmitTimeoutError) {
    return err.message;
  }

  // Its message may embed contract diagnostics whose free text ("cancelled",
  // "denied", …) would otherwise trip the wallet-rejection regex below and
  // misreport an on-chain failure as a declined signature.
  if (err instanceof InvokeFailedError) {
    return err.message;
  }

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
