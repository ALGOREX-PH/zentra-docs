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

import { isApiError, toErrorBody } from './errors';
import { log, newRequestId } from './logger';

/** Longest inbound `x-request-id` we will echo; anything larger is replaced. */
const MAX_INBOUND_REQUEST_ID = 200;

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
        return NextResponse.json(body, {
          status,
          headers: { ...headers, 'x-request-id': requestId },
        });
      } catch {
        // The catch block is the last line of defence, so it may not throw
        // either — fall back to a hand-written envelope with no dependencies.
        return new Response(
          '{"error":{"code":"internal","message":"Internal server error."}}',
          {
            status: 500,
            headers: {
              'content-type': 'application/json',
              'cache-control': 'no-store',
              'x-request-id': requestId,
            },
          },
        );
      }
    }
  };
}

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

/**
 * Reuse the caller's `x-request-id` when it is present and sane, else mint one.
 *
 * Echoing the inbound id keeps a trace intact across services; the length cap
 * stops an unbounded header from being copied into every log line.
 */
function resolveRequestId(request: Request): string {
  const inbound = request.headers.get('x-request-id')?.trim();
  if (inbound && inbound.length <= MAX_INBOUND_REQUEST_ID) return inbound;
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
