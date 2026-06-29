/**
 * Shared types for the Zentra dApp payment flow.
 *
 * One place defines the lifecycle so the libs that drive a transaction and the
 * components that render it never drift on phase names or result shape.
 */

/** Lifecycle of a payment as the UI walks it from intent to settlement. */
export type TxPhase =
  | 'idle'
  | 'building'
  | 'signing'
  | 'submitting'
  | 'success'
  | 'error';

/** What the UI renders at each step of a send. */
export interface TxState {
  phase: TxPhase;
  /** Transaction hash, present once submitted (success or, sometimes, failure). */
  hash?: string;
  /** Human-readable status or error message. */
  message?: string;
}

/** A user's intent to move XLM on testnet. */
export interface PaymentRequest {
  destination: string;
  /** XLM amount as a decimal string, e.g. "12.5". */
  amount: string;
}

/** The result of a settled payment. */
export interface PaymentResult {
  hash: string;
  ledger?: number;
}
