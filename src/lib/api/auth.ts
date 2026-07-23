/**
 * Shared-secret operator gate for the few endpoints only we are meant to call.
 *
 * This is not a user authentication system. There are no accounts, sessions,
 * roles or expiry here — just one process-wide secret in `ADMIN_TOKEN` compared
 * against a bearer credential on the request. That is enough for the small set
 * of operator-only routes (exporting the onboarding registry, hiding an abusive
 * feedback row) and it is appropriate for nothing else: anything a real user
 * touches needs real identity, and anything with more than one operator needs
 * per-person credentials that can be revoked individually.
 *
 * Two rules hold everywhere in this file. An unset secret denies every request
 * rather than opening the route, because a deploy that forgot the variable must
 * fail closed. And neither the supplied nor the expected token is ever written
 * to a log, in whole, hashed or truncated — a denial line carries only why.
 */

import { ApiError, upstreamUnavailable } from '@/lib/api/errors';
import { log } from '@/lib/api/logger';

/** Name of the environment variable holding the operator shared secret. */
export const ADMIN_TOKEN_ENV = 'ADMIN_TOKEN';

/** Evidence that a request carried a valid operator credential. */
export interface AdminContext {
  /** Always true when returned; the failure path throws instead. */
  authorized: true;
}

/** Why a request was refused, as it appears in the `admin.denied` log line. */
type DenialReason = 'not_configured' | 'missing' | 'invalid';

/** A credential presented as `Bearer <token>`, with the scheme case-insensitive. */
const BEARER = /^bearer[ \t]+(.+)$/i;

/**
 * Whether a usable `ADMIN_TOKEN` is configured on this deployment.
 *
 * Lets a route advertise itself as unavailable rather than unauthorised, so an
 * operator hitting a box that was never given the secret gets a 503 that says
 * so instead of a 401 they would waste time re-authenticating against. Blank
 * and whitespace-only values count as absent — an empty `ADMIN_TOKEN=` line
 * must not be mistaken for a configured one.
 */
export function isAdminConfigured(): boolean {
  return (process.env[ADMIN_TOKEN_ENV] ?? '').trim().length > 0;
}

/**
 * Authorise an operator request, or throw the `ApiError` the route should return.
 *
 * Checks configuration before credentials, so a request carrying a perfectly
 * correct-looking token still fails with the not-configured 503 when the secret
 * is absent — there is no value of the header that can open an ungated box.
 * Otherwise a missing or malformed credential is a 401 and a wrong one a 403.
 */
export function requireAdmin(request: Request, requestId: string): AdminContext {
  const expected = process.env[ADMIN_TOKEN_ENV] ?? '';
  if (expected.trim().length === 0) {
    throw deny(requestId, 'not_configured');
  }

  const supplied = readCredential(request);
  if (supplied === null) {
    throw deny(requestId, 'missing');
  }

  if (!timingSafeEqual(supplied, expected)) {
    throw deny(requestId, 'invalid');
  }

  log('info', 'admin.authorized', { requestId });
  return { authorized: true };
}

/**
 * Compare two strings without letting the runtime reveal where they first differ.
 *
 * Every call iterates `Math.max(a.length, b.length)` characters and folds each
 * XOR into one accumulator, so a credential that matches the first character
 * costs the same as one that matches all but the last. Reading past the end of
 * a string yields `NaN`, which `| 0` folds to zero, keeping the work per
 * iteration identical for the shorter operand. Length is mixed into the
 * accumulator up front and re-checked at the end.
 *
 * This reduces the timing side channel rather than eliminating it: JavaScript
 * string comparison cannot be made truly constant-time. Engine-level interning
 * can answer an identity check before a single character is read, rope and
 * slice representations flatten lazily, GC can pause anywhere, and JIT tiering
 * changes the cost of the loop mid-run. Treat it as raising the number of
 * samples an attacker needs, not as a guarantee. Node's
 * `crypto.timingSafeEqual` is the real primitive, but it throws on inputs of
 * differing length — which for a secret comparison leaks length by itself —
 * so it is not usable directly on raw strings from a header.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let result = a.length ^ b.length;

  for (let i = 0; i < length; i += 1) {
    result |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  }

  return result === 0 && a.length === b.length;
}

/**
 * Log the denial and build the error to throw, never recording the credential.
 *
 * Every refusal funnels through here so the warn line and the status can never
 * drift apart, and so there is exactly one place to audit for a leaked secret.
 */
function deny(requestId: string, reason: DenialReason): ApiError {
  log('warn', 'admin.denied', { requestId, reason });

  if (reason === 'not_configured') {
    // 503 rather than 401: the fault is ours, and telling the caller their
    // credential was wrong would be a lie that sends them looking in the
    // wrong place. `upstream_unavailable` is the closest existing code.
    return upstreamUnavailable('Admin access is not configured.');
  }
  if (reason === 'missing') {
    return new ApiError(401, 'bad_request', 'Admin credentials are required.');
  }
  return new ApiError(403, 'bad_request', 'Admin credentials are not valid.');
}

/**
 * Pull the operator token from the request headers, or null if none is usable.
 *
 * `authorization` wins when present, and a present-but-non-bearer value is a
 * refusal rather than a reason to look further: a caller who sent Basic or a
 * cookie meant that, and silently accepting a second header would make the
 * request's own credential ambiguous. `x-admin-token` is consulted only when
 * `authorization` is absent entirely, for curl and CI callers.
 */
function readCredential(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  if (authorization !== null) {
    const match = BEARER.exec(authorization.trim());
    if (match === null) return null;
    return nonEmpty(match[1]);
  }

  const header = request.headers.get('x-admin-token');
  return header === null ? null : nonEmpty(header);
}

/** Trim a header value, treating a blank result as no credential at all. */
function nonEmpty(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
