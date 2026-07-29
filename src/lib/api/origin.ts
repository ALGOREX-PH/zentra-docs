/**
 * Same-origin gate for the routes that change state.
 *
 * This closes the other half of ZEN-12. Requiring `application/json` (see
 * `readJsonBody`) stops a cross-site page from *silently* posting here, because
 * that media type is not on the CORS safelist and so forces a preflight. This
 * module stops the request that does send a preflight, or that arrives from a
 * page hosted somewhere we do not control at all: the browser attaches an
 * `Origin` header it cannot be talked out of, and we compare it against our own
 * authority.
 *
 * There are no cookies and no sessions in this application, so this is not
 * classic CSRF defence — nothing is authenticated, so nothing can be confused
 * into acting with someone else's privileges. What it protects is attribution:
 * without it, a page with traffic can turn every one of its visitors into a
 * submission from that visitor's own IP, spreading writes across as many
 * rate-limit buckets as there are readers and filling the tables the growth
 * metrics are computed from with rows nobody meant to send.
 *
 * A request with no `Origin` at all is allowed through. Browsers send the header
 * on every POST and PATCH regardless of where the page came from, so an absent
 * one means a non-browser client — curl, CI, an uptime check — which is not the
 * threat this addresses and which we would break for nothing by refusing.
 */

import { forbidden } from '@/lib/api/errors';
import { log } from '@/lib/api/logger';
import { siteUrl } from '@/lib/site';

/** Longest `origin` header we will parse; anything larger is refused outright. */
const MAX_ORIGIN_LENGTH = 2048;

/**
 * Whether `request` came from a page we serve, refusing it with a 403 if not.
 *
 * Comparison is on the *authority* — host and port — rather than the full
 * origin, because the scheme we see is not the scheme the browser used: TLS
 * terminates at the edge and the request reaches the function over plain HTTP,
 * so a strict origin match would reject every real request in production. The
 * host is what identifies the site, and it is the part an attacker's page
 * cannot forge.
 */
export function requireSameOrigin(request: Request, requestId: string): void {
  const origin = request.headers.get('origin');

  // No header, no browser. Nothing to check and nothing to gain by refusing.
  if (origin === null) return;

  const authority = originAuthority(origin);
  if (authority !== null && allowedAuthorities(request).has(authority)) return;

  // The offending value is not logged. It is attacker-chosen text and this line
  // ships to a third-party drain; the request id is enough to correlate.
  log('warn', 'origin.rejected', { requestId });
  throw forbidden('Cross-origin requests are not accepted on this endpoint.');
}

/**
 * The authorities a request may legitimately claim to have come from.
 *
 * Two sources, and both are what the deployment says about itself rather than
 * what the caller says. `host` is the authority the browser resolved and put in
 * the request line, so a page on another domain cannot make it match its own
 * `Origin`. `NEXT_PUBLIC_SITE_URL` covers the case where a proxy rewrites the
 * host to something internal, which would otherwise leave the canonical domain
 * failing its own check. `x-forwarded-host` is honoured for the same reason: on
 * a platform that rewrites `host`, it is the only record of what the browser
 * actually asked for.
 */
function allowedAuthorities(request: Request): Set<string> {
  const allowed = new Set<string>();

  for (const header of ['host', 'x-forwarded-host']) {
    const value = request.headers.get(header)?.trim().toLowerCase();
    // A forwarding header may carry a list; the first entry is the client-facing
    // name, which is the one an `Origin` would have been built from.
    const first = value?.split(',')[0]?.trim();
    if (first) allowed.add(first);
  }

  const canonical = authorityOf(siteUrl);
  if (canonical !== null) allowed.add(canonical);

  return allowed;
}

/**
 * Reduce an `origin` header to its lowercase authority, or null if unusable.
 *
 * The literal string `null` — what a sandboxed iframe or a cross-origin
 * redirect sends — fails to parse and is therefore refused, which is correct:
 * an opaque origin is by definition not ours.
 */
function originAuthority(origin: string): string | null {
  const trimmed = origin.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ORIGIN_LENGTH) return null;
  return authorityOf(trimmed);
}

/** The lowercase `host:port` of an absolute http(s) URL, or null. */
function authorityOf(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.host.toLowerCase();
  } catch {
    return null;
  }
}
