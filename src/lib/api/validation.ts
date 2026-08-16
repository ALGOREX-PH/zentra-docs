/**
 * Request parsing and validation for the JSON API routes.
 *
 * Everything that arrives from the network is `unknown` until it passes
 * through here — bodies from `readJsonBody`, and URL parameters from
 * `parseSearchQuery`. Each parser is a trust boundary of the same shape: it
 * accumulates every field error before throwing, and rebuilds the value key by
 * key so no caller-supplied extra ever reaches the database or the index.
 */

import {
  badRequest,
  payloadTooLarge,
  unsupportedMediaType,
  validationFailed,
} from '@/lib/api/errors';

/** Longest comment we store, in characters, after whitespace normalisation. */
export const MAX_COMMENT_LENGTH = 280;

/** Longest name we store, in characters, after whitespace normalisation. */
export const MAX_NAME_LENGTH = 80;

/** Longest signup note we store, in characters, after whitespace normalisation. */
export const MAX_NOTE_LENGTH = 500;

/** Longest search phrase we will tokenise. Past this it is not a search. */
export const MAX_QUERY_LENGTH = 256;

/** Most search results a caller may ask for in one response. */
export const MAX_RESULT_LIMIT = 50;

/** Most tags a caller may filter a search on at once. */
export const MAX_TAGS = 8;

/** Longest single search tag or locale we will accept. */
export const MAX_FACET_LENGTH = 64;

/** Largest request body we will read, in bytes. */
export const MAX_BODY_BYTES = 4096;

/** The media type a JSON body must be labelled with, as told to the caller. */
export const JSON_MEDIA_TYPE = 'application/json';

/**
 * The media types `readJsonBody` will parse.
 *
 * `application/json` plus the `+json` structured suffix, with any parameters
 * (`; charset=utf-8`) allowed after them. Everything else is refused, and that
 * refusal is load-bearing rather than pedantic — see `readJsonBody`.
 */
const JSON_CONTENT_TYPE = /^application\/(?:[\w.-]+\+)?json\s*(?:;|$)/i;

/** A feedback submission after validation — exactly the fields we persist. */
export interface FeedbackInput {
  rating: number;
  comment: string;
  wallet: string | null;
  txHash: string | null;
  onChain: boolean;
}

/** A signup after validation — exactly the fields we persist to `users`. */
export interface UserInput {
  name: string;
  email: string;
  wallet: string;
  rating: number | null;
  note: string | null;
}

/** A search request after validation — exactly what the index is given. */
export interface SearchQuery {
  query: string;
  locale: string | undefined;
  tag: string[] | undefined;
  limit: number | undefined;
}

/** A Stellar Ed25519 public key: `G` plus 55 base32 characters. */
const STELLAR_ACCOUNT_ID = /^G[A-Z2-7]{55}$/;

/** A 32-byte transaction hash rendered as hex. */
const TX_HASH = /^[0-9a-f]{64}$/i;

/**
 * A deliberately loose address shape: something, an `@`, a dotted host.
 *
 * The only authority on whether an address exists is a message sent to it, so
 * anything stricter would reject valid addresses without catching invented
 * ones. This filters out typos and obvious junk and leaves it there.
 */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Longest address the SMTP standard permits, and so the longest we accept. */
const MAX_EMAIL_LENGTH = 254;

/** Search tags and locales are identifiers, not free text. */
const FACET = /^[A-Za-z0-9_.-]+$/;

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

/** Whether `value` is a plausible email address within the 254-character limit. */
export function isEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_EMAIL_LENGTH && EMAIL.test(value);
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
      // Accepted case-insensitively, stored lowercase: the database CHECK and
      // the unique index both assume lowercase hex, so an upper-case hash from
      // a client would otherwise be rejected by Postgres as a 500.
      txHash = body.txHash.toLowerCase();
    } else {
      details.txHash = 'Transaction hash must be 64 hex characters.';
    }
  }

  // An on-chain claim is proven by the route's Horizon lookup, and that
  // lookup's ownership check is only as strong as the wallet it is given: with
  // no wallet it would confirm merely that *someone's* transaction exists, so
  // any harvested public hash could earn the badge. A claim backed by a hash
  // must therefore also name the wallet that made it — required here, proven
  // against the ledger by the route. A wallet that is present but malformed
  // already carries its own message above and keeps it.
  if (Boolean(body.onChain) && isPresent(body.txHash) && !isPresent(body.wallet)) {
    details.wallet = 'Wallet is required when onChain is true.';
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
 * Validate a decoded request body into a `UserInput`.
 *
 * Same contract as `parseFeedbackInput`: a 400 when the body is not a JSON
 * object, otherwise a single 422 listing every field that failed. `name`,
 * `email` and `wallet` are required; `rating` and `note` are optional and
 * become `null` when absent.
 */
export function parseUserInput(raw: unknown): UserInput {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw badRequest('Request body must be a JSON object.');
  }

  const body = raw as Record<string, unknown>;
  const details: Record<string, string> = {};

  const name = typeof body.name === 'string' ? cleanComment(body.name) : '';
  if (name.length < 1 || name.length > MAX_NAME_LENGTH) {
    details.name = 'Name must be 1–80 characters.';
  }

  // Lowercased on the way in because the unique index is on `lower(email)`:
  // storing the address as typed would let `Ada@…` and `ada@…` both be
  // inserted and then collide inside Postgres as a 500 rather than a 409.
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!isEmail(email)) {
    details.email = 'Email must be a valid address.';
  }

  let wallet = '';
  if (isStellarAccountId(body.wallet)) {
    wallet = body.wallet;
  } else {
    details.wallet = 'Wallet must be a valid Stellar account id (G…).';
  }

  let rating: number | null = null;
  if (isPresent(body.rating)) {
    const value = body.rating;
    if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5) {
      rating = value;
    } else {
      details.rating = 'Rating must be an integer between 1 and 5.';
    }
  }

  let note: string | null = null;
  if (isPresent(body.note)) {
    // Normalised exactly like a comment: the two fields are free text from the
    // same form and there is no reason for them to be stored differently.
    const cleaned = typeof body.note === 'string' ? cleanComment(body.note) : '';
    if (cleaned.length >= 1 && cleaned.length <= MAX_NOTE_LENGTH) {
      note = cleaned;
    } else {
      details.note = 'Note must be 1–500 characters.';
    }
  }

  if (Object.keys(details).length > 0) {
    throw validationFailed(details);
  }

  return {
    name,
    email,
    wallet,
    rating,
    note,
  };
}

/**
 * Validate the URL parameters of a search request into a `SearchQuery`.
 *
 * Same contract as the body parsers: one 422 listing every parameter that
 * failed. An absent or blank `query` is not a failure and comes back as an
 * empty string — the search dialog issues exactly that request every time it
 * opens, and the route answers it with an empty result set.
 *
 * The bounds are the point. Each of these values is handed to the search index
 * and every one of them was previously unchecked: an unbounded `query` is CPU
 * we spend tokenising on request, a `limit` of a million is a result set we
 * allocate on demand, and `tag` and `locale` are matched against the index's
 * own facets and so belong to the identifier alphabet rather than to free text.
 */
export function parseSearchQuery(params: URLSearchParams): SearchQuery {
  const details: Record<string, string> = {};

  const query = (params.get('query') ?? '').trim();
  if (query.length > MAX_QUERY_LENGTH) {
    details.query = `Query must be at most ${MAX_QUERY_LENGTH} characters.`;
  }

  let locale: string | undefined;
  const rawLocale = params.get('locale')?.trim();
  if (rawLocale) {
    if (rawLocale.length <= MAX_FACET_LENGTH && FACET.test(rawLocale)) {
      locale = rawLocale;
    } else {
      details.locale = 'Locale must be a short identifier.';
    }
  }

  let tag: string[] | undefined;
  const rawTag = params.get('tag')?.trim();
  if (rawTag) {
    // Sent as one comma-separated value by the search client, so it is split
    // the same way here rather than read as a repeated parameter.
    const parts = rawTag
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    if (
      parts.length === 0 ||
      parts.length > MAX_TAGS ||
      parts.some((part) => part.length > MAX_FACET_LENGTH || !FACET.test(part))
    ) {
      details.tag = `Tag must be up to ${MAX_TAGS} short identifiers, comma separated.`;
    } else {
      tag = parts;
    }
  }

  let limit: number | undefined;
  const rawLimit = params.get('limit')?.trim();
  if (rawLimit) {
    const value = Number(rawLimit);
    if (Number.isSafeInteger(value) && value >= 1 && value <= MAX_RESULT_LIMIT) {
      limit = value;
    } else {
      details.limit = `Limit must be an integer between 1 and ${MAX_RESULT_LIMIT}.`;
    }
  }

  if (Object.keys(details).length > 0) {
    throw validationFailed(details);
  }

  return { query, locale, tag, limit };
}

/**
 * Read and JSON-decode a request body, refusing anything over the byte ceiling.
 *
 * The `content-type` is checked before anything is read. That check is a
 * security control, not a formality: `application/json` is not on the CORS
 * safelist, so demanding it forces a browser to send a preflight the attacker's
 * page cannot satisfy, and closes the cross-site *simple request* path — an
 * HTML form posting `enctype="text/plain"`, or a `fetch` with
 * `content-type: text/plain` — that would otherwise land a write here with no
 * preflight at all (ZEN-12). It is checked first so a body sent that way is
 * refused before we spend anything reading it.
 *
 * The `content-length` header is checked next so an oversized upload is
 * rejected before the stream is touched, then the decoded text is measured
 * again in case that header was absent or lying.
 */
export async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type');
  if (contentType === null || !JSON_CONTENT_TYPE.test(contentType.trim())) {
    throw unsupportedMediaType(JSON_MEDIA_TYPE);
  }

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
 * Whitespace is normalised first because newlines and tabs are themselves
 * control characters: stripping them up front would weld two words together,
 * whereas collapsing turns them into the word boundary they visually were. The
 * pass is repeated afterwards so a control character removed from between two
 * spaces does not leave a double space behind.
 */
function cleanComment(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(CONTROL_CHARACTERS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whether an optional field was supplied as something other than an empty value. */
function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return !(typeof value === 'string' && value.trim().length === 0);
}
