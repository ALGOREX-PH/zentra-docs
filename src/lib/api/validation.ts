/**
 * Request parsing and validation for the JSON API routes.
 *
 * Everything that arrives from the network is `unknown` until it passes
 * through here. `parseFeedbackInput` is the trust boundary: it accumulates
 * every field error before throwing, and rebuilds the value key by key so no
 * caller-supplied extra ever reaches the database.
 */

import { badRequest, payloadTooLarge, validationFailed } from '@/lib/api/errors';

/** Longest comment we store, in characters, after whitespace normalisation. */
export const MAX_COMMENT_LENGTH = 280;

/** Largest request body we will read, in bytes. */
export const MAX_BODY_BYTES = 4096;

/** A feedback submission after validation — exactly the fields we persist. */
export interface FeedbackInput {
  rating: number;
  comment: string;
  wallet: string | null;
  txHash: string | null;
  onChain: boolean;
}

/** A Stellar Ed25519 public key: `G` plus 55 base32 characters. */
const STELLAR_ACCOUNT_ID = /^G[A-Z2-7]{55}$/;

/** A 32-byte transaction hash rendered as hex. */
const TX_HASH = /^[0-9a-f]{64}$/i;

/** ASCII control characters, which have no business in a stored comment. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

/** Whether `value` is a well-formed Stellar account id (`G…`, 56 characters). */
export function isStellarAccountId(value: unknown): value is string {
  return typeof value === 'string' && STELLAR_ACCOUNT_ID.test(value);
}

/** Whether `value` is a well-formed transaction hash (64 hex characters). */
export function isTxHash(value: unknown): value is string {
  return typeof value === 'string' && TX_HASH.test(value);
}

/**
 * Validate a decoded request body into a `FeedbackInput`.
 *
 * Throws a 400 when the body is not a JSON object, or a 422 listing every
 * field that failed — one round trip is enough for the client to fix the form.
 */
export function parseFeedbackInput(raw: unknown): FeedbackInput {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw badRequest('Request body must be a JSON object.');
  }

  const body = raw as Record<string, unknown>;
  const details: Record<string, string> = {};

  const rating = body.rating;
  if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    details.rating = 'Rating must be an integer between 1 and 5.';
  }

  const comment = typeof body.comment === 'string' ? cleanComment(body.comment) : '';
  if (comment.length < 1 || comment.length > MAX_COMMENT_LENGTH) {
    details.comment = 'Comment must be 1–280 characters.';
  }

  let wallet: string | null = null;
  if (isPresent(body.wallet)) {
    if (isStellarAccountId(body.wallet)) {
      wallet = body.wallet;
    } else {
      details.wallet = 'Wallet must be a valid Stellar account id (G…).';
    }
  }

  let txHash: string | null = null;
  if (isPresent(body.txHash)) {
    if (isTxHash(body.txHash)) {
      txHash = body.txHash;
    } else {
      details.txHash = 'Transaction hash must be 64 hex characters.';
    }
  }

  if (Object.keys(details).length > 0) {
    throw validationFailed(details);
  }

  return {
    rating: rating as number,
    comment,
    wallet,
    txHash,
    // A claim of being on-chain is only as good as the hash backing it, so an
    // unverifiable claim is quietly downgraded rather than rejected.
    onChain: Boolean(body.onChain) && txHash !== null,
  };
}

/**
 * Read and JSON-decode a request body, refusing anything over the byte ceiling.
 *
 * The `content-length` header is checked first so an oversized upload is
 * rejected before the stream is touched, then the decoded text is measured
 * again in case that header was absent or lying.
 */
export async function readJsonBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw payloadTooLarge(MAX_BODY_BYTES);
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    throw payloadTooLarge(MAX_BODY_BYTES);
  }
  if (text.trim().length === 0) {
    throw badRequest('Request body is required.');
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw badRequest('Request body must be valid JSON.');
  }
}

/**
 * Collapse whitespace runs to single spaces, drop control characters, trim.
 *
 * Whitespace is normalised first so newlines and tabs become word boundaries
 * instead of vanishing and welding two words together.
 */
function cleanComment(value: string): string {
  return value.replace(/\s+/g, ' ').replace(CONTROL_CHARACTERS, '').trim();
}

/** Whether an optional field was supplied as something other than an empty value. */
function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return !(typeof value === 'string' && value.trim().length === 0);
}
