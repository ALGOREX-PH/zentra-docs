/**
 * The wrapper every JSON API route is defined through.
 *
 * Handlers are written as if nothing can go wrong; `route` supplies the parts
 * that must never vary between endpoints — a request id on every response, one
 * structured log line per request, and a single error envelope shape produced
 * from whatever was thrown. Because the wrapper owns those concerns, no route
 * can forget them and no route can invent its own version of them.
 */

import { NextResponse } from 'next/server';

import { isApiError, methodNotAllowed as methodNotAllowedError, toErrorBody } from './errors';
import { log, newRequestId } from './logger';

/** Longest inbound `x-request-id` we will echo; anything larger is replaced. */
const MAX_INBOUND_REQUEST_ID = 200;

/**
 * The alphabet an inbound `x-request-id` must be drawn from to be echoed.
 *
 * Wide enough for every id format anything upstream of us actually emits — a
 * UUID, a hex trace id, a `service:instance:counter`, a base64 span id — and
 * nothing else.
 *
 * The point is that this value is reflected, three ways: into a response
 * header, into every log line the request produces, and into the body of
 * `/api/health`. Each of those has its own escaping and each of them currently
 * holds, but they hold for three different reasons and none of them is stated
 * here. Constraining the id to an identifier at the one place it enters the
 * system makes all three safe by construction instead, and costs a caller
 * nothing: a value outside this set is discarded and a fresh id minted, so the
 * request is still traceable — under our id rather than theirs.
 */
const REQUEST_ID_ALPHABET = /^[A-Za-z0-9_.:@+/=-]+$/;

/** Per-request values the wrapper hands down to the handler it wraps. */
export interface RouteContext {
  requestId: string;
}

/** A route body: the request plus its context in, a `Response` out. */
export type RouteHandler = (request: Request, context: RouteContext) => Promise<Response>;

/**
 * Wrap `handler` as a Next route handler with logging, request ids and error
 * shaping applied.
 *
 * `name` labels the route in the logs — use a short stable string such as
 * `feedback.create`. The returned function resolves rather than rejects for
 * every input: anything the handler throws becomes a JSON error response.
 */
export function route(
  name: string,
  handler: RouteHandler,
): (request: Request) => Promise<Response> {
  return async function wrappedRoute(request: Request): Promise<Response> {
    const requestId = resolveRequestId(request);
    const method = request.method;
    const startedAt = Date.now();

    try {
      const response = await handler(request, { requestId });
      log('info', 'request', {
        name,
        method,
        status: response.status,
        durationMs: Date.now() - startedAt,
        requestId,
      });
      return withRequestId(response, requestId);
    } catch (error) {
      try {
        const { status, body, headers } = toErrorBody(error);
        // Our own errors carry a client-safe message and nothing more worth
        // logging; unknown throws are attached raw so the logger can redact
        // and serialise whatever they turn out to be.
        log(status >= 500 ? 'error' : 'warn', 'request', {
          name,
          method,
          status,
          durationMs: Date.now() - startedAt,
          requestId,
          code: body.error.code,
          ...(isApiError(error) ? {} : { err: error }),
        });
        // `no-store` leads so an error carrying its own headers can still
        // override it, and so nothing else has to remember: a failure is a
        // property of one attempt by one caller at one moment, and a 429 or a
        // 503 replayed from a shared cache to somebody else is worse than
        // useless. Several of these statuses are heuristically cacheable when
        // no directive is present, which is exactly what this removes.
        return NextResponse.json(body, {
          status,
          headers: { 'cache-control': 'no-store', ...headers, 'x-request-id': requestId },
        });
      } catch {
        // The catch block is the last line of defence, so it may not throw
        // either — fall back to a hand-written envelope with no dependencies.
        return new Response('{"error":{"code":"internal","message":"Internal server error."}}', {
          status: 500,
          headers: {
            'content-type': 'application/json',
            'cache-control': 'no-store',
            'x-request-id': requestId,
          },
        });
      }
    }
  };
}

/**
 * The cache policy shared by the public live-dashboard reads.
 *
 * How long a CDN may serve the response before revalidating. These endpoints
 * feed live numbers — the feedback summary, the signup counter — so the window
 * is short; `stale-while-revalidate` keeps them responsive under load (and
 * absorbs a launch-day spike) without ever showing badly stale figures. A route
 * whose data changes on a different clock declares its own policy instead of
 * borrowing this one.
 */
export const READ_CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=120';

/**
 * Build a JSON response that is never cached unless the caller says otherwise.
 *
 * `no-store` is a default rather than a rule: anything in `init.headers` wins,
 * so a route serving cacheable data can override it in place.
 */
export function json<T>(
  data: T,
  init?: { status?: number; headers?: Record<string, string> },
): NextResponse {
  return NextResponse.json(data, {
    status: init?.status ?? 200,
    headers: { 'cache-control': 'no-store', ...init?.headers },
  });
}

/** The HTTP methods a Next route module can export a handler for, minus the
 * two the framework derives on its own (`HEAD` from `GET`, and `OPTIONS`). */
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Handlers a route exports for the HTTP methods it does not serve.
 *
 * Next answers a request for a method the module never exported with a bare
 * 405 — the right status, but an empty body outside every guarantee the other
 * responses keep: no JSON envelope for a client to branch on, no request id,
 * no log line. Exporting these instead keeps the contract uniform, and because
 * the handler is built through `route`, the 405 arrives exactly like every
 * other error: enveloped, correlated and logged. The `Allow` header RFC 9110
 * requires rides on the thrown error (see `toErrorBody`).
 *
 * The returned record carries every method, so a route destructures just the
 * ones it does not implement — exporting a supported method from both places
 * is a duplicate-identifier compile error, not a silent override:
 *
 *     export const { PUT, PATCH, DELETE } = methodNotAllowed(['GET', 'POST']);
 */
export function methodNotAllowed(
  allow: HttpMethod[],
): Record<HttpMethod, (request: Request) => Promise<Response>> {
  const handler = route('method_not_allowed', async () => {
    throw methodNotAllowedError(allow);
  });
  return { GET: handler, POST: handler, PUT: handler, PATCH: handler, DELETE: handler };
}

/**
 * Reuse the caller's `x-request-id` when it is present and sane, else mint one.
 *
 * Echoing the inbound id keeps a trace intact across services; the length cap
 * stops an unbounded header from being copied into every log line, and the
 * alphabet check stops the value being anything but an identifier — see
 * `REQUEST_ID_ALPHABET` for what that prevents.
 */
function resolveRequestId(request: Request): string {
  const inbound = request.headers.get('x-request-id')?.trim();
  if (inbound && inbound.length <= MAX_INBOUND_REQUEST_ID && REQUEST_ID_ALPHABET.test(inbound)) {
    return inbound;
  }
  return newRequestId();
}

/**
 * Return `response` carrying `x-request-id`, cloning it if its headers are
 * immutable.
 *
 * A `NextResponse` the handler built is mutable and takes the cheap path; one
 * proxied straight from `fetch` is not, and throws on `set`, so it is rebuilt
 * with a fresh header set and the original body streamed through.
 */
function withRequestId(response: Response, requestId: string): Response {
  try {
    response.headers.set('x-request-id', requestId);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    headers.set('x-request-id', requestId);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}
