/**
 * The fee sponsorship API — gasless transactions via fee-bump.
 *
 * `GET` reports whether sponsorship is available on this deployment, so the UI
 * can offer a gasless path only when there is actually an account behind it.
 * `POST` takes a user-signed inner transaction and returns it wrapped in a
 * fee-bump signed by the sponsor, which is what makes a wallet holding zero XLM
 * able to transact at all.
 *
 * This is the one route in the app that spends money on a stranger's behalf, so
 * it is written to be boring: a tight rate limit, a hard size cap, and a
 * refusal for anything `inspectInnerTransaction` does not positively approve.
 * Neither the submitted XDR nor the sponsor secret is ever written to a log
 * line, returned in an error, or echoed back in a validation detail.
 */

import {
  badRequest,
  forbidden,
  payloadTooLarge,
  rateLimited,
  upstreamUnavailable,
  validationFailed,
} from '@/lib/api/errors';
import { log } from '@/lib/api/logger';
import {
  clientKey,
  rateLimit,
  rateLimitHeaders,
  type RateLimitOptions,
} from '@/lib/api/rate-limit';
import { json, route } from '@/lib/api/route';
import {
  buildFeeBump,
  inspectInnerTransaction,
  isSponsorConfigured,
  sponsorPublicKey,
  MAX_SPONSORED_FEE_STROOPS,
  type SponsorDecision,
} from '@/lib/api/sponsor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The status read touches nothing but the environment, so it is cheap. */
const READ_LIMIT: RateLimitOptions = { limit: 60, windowMs: 60_000 };

/**
 * Deliberately far tighter than any other write in the app.
 *
 * Every success here costs us lumens we do not get back, so the budget is five
 * bumps per caller per ten minutes rather than the usual per-minute allowance.
 * The limiter is per-instance and per-IP and so is a speed bump rather than a
 * guarantee — the contract allowlist in `@/lib/api/sponsor` is what actually
 * stops the balance being drained, and this only slows down the attempt.
 */
const WRITE_LIMIT: RateLimitOptions = { limit: 5, windowMs: 10 * 60_000 };

/** Largest request body we will read at all, leaving room for JSON framing. */
const MAX_REQUEST_BYTES = 96 * 1024;

/** Longest XDR string we will consider, in characters. */
const MAX_XDR_LENGTH = 64 * 1024;

export const GET = route('sponsor.status', async (request) => {
  const headers = enforceRateLimit(request, 'sponsor:read', READ_LIMIT);

  // All three fields are public by nature: the address is the fee source the
  // ledger records on every bump we sign, and the ceiling is a policy number.
  // No secret material passes through here.
  return json(
    {
      configured: isSponsorConfigured(),
      sponsor: sponsorPublicKey(),
      maxFeeStroops: MAX_SPONSORED_FEE_STROOPS,
    },
    { headers },
  );
});

export const POST = route('sponsor.bump', async (request, { requestId }) => {
  const headers = enforceRateLimit(request, 'sponsor:write', WRITE_LIMIT);

  const xdr = readXdr(await readBody(request));

  if (!isSponsorConfigured()) {
    // A deployment without a funded sponsor is unavailable, not forbidden: the
    // caller did nothing wrong and there is nothing they could change to make
    // this request succeed.
    refused(requestId, 'not_configured');
    throw upstreamUnavailable('Fee sponsorship is not configured.');
  }

  const decision = inspectInnerTransaction(xdr);
  if (!decision.allowed) {
    refused(requestId, decision.reason);
    // The reason is named so a client can tell "you asked us to pay for the
    // wrong thing" from "your envelope is broken", but the XDR itself is never
    // echoed — it is the caller's data and there is nothing to gain by
    // reflecting it back into an error body or a log drain.
    throw forbidden(`Fee sponsorship refused: ${decision.reason}.`);
  }

  let signed: string;
  try {
    signed = buildFeeBump(xdr);
  } catch (error) {
    // An approved transaction that will not bump is our bug, not the caller's,
    // so it is a 503 and it is logged with the underlying error attached. The
    // sponsor module guarantees the secret is in neither.
    log('error', 'sponsor.build_failed', { requestId, err: error });
    refused(requestId, 'malformed');
    throw upstreamUnavailable('The fee-bump could not be built.');
  }

  log('info', 'sponsor.granted', { requestId, reason: decision.reason });

  // The signed envelope goes back to the client to submit, and the server never
  // broadcasts it. Two reasons. Submitting here would make us the broadcast
  // path for every sponsored transaction, so an RPC outage or a slow ledger
  // would turn into our request timing out while the fee may or may not have
  // been spent — ambiguous in exactly the case where money moved. And a
  // submission that fails is the client's to retry: it already has the wallet,
  // the sequence number and the user in front of it, and it is the only party
  // that can tell whether retrying is the right answer.
  return json({ xdr: signed }, { headers });
});

/** Record one refusal, carrying the reason and nothing that could identify the payload. */
function refused(requestId: string, reason: SponsorDecision['reason']): void {
  log('warn', 'sponsor.refused', { requestId, reason });
}

/**
 * Count one request against the caller's budget, or reject it with a 429.
 *
 * Returns the `X-RateLimit-*` headers to attach to a successful response so a
 * well-behaved client can back off before it is turned away.
 */
function enforceRateLimit(
  request: Request,
  scope: string,
  options: RateLimitOptions,
): Record<string, string> {
  const result = rateLimit(clientKey(request, scope), options);
  if (!result.ok) throw rateLimited(result.retryAfterSeconds);
  return rateLimitHeaders(result);
}

/**
 * Read and JSON-decode the request body, refusing anything over the byte cap.
 *
 * The shared `readJsonBody` caps bodies at 4KB, which a Soroban envelope
 * routinely exceeds, so this route carries its own ceiling. `content-length` is
 * checked before the stream is touched and the decoded text is measured again
 * in case that header was absent or lying.
 */
async function readBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    throw payloadTooLarge(MAX_REQUEST_BYTES);
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_REQUEST_BYTES) {
    throw payloadTooLarge(MAX_REQUEST_BYTES);
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
 * Pull `xdr` out of a decoded body, or throw the error describing what is wrong.
 *
 * Only the shape is checked here — whether the string is a *transaction we will
 * pay for* is `inspectInnerTransaction`'s question, and answering it early
 * would split the abuse policy across two files. The failure detail describes
 * the field without quoting its value.
 */
function readXdr(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw badRequest('Request body must be a JSON object.');
  }

  const value = (raw as Record<string, unknown>).xdr;
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_XDR_LENGTH) {
    throw validationFailed({
      xdr: 'xdr must be a non-empty base64 transaction envelope under 64KB.',
    });
  }

  return value.trim();
}
