/**
 * Framework-free error vocabulary for the JSON API routes.
 *
 * Route handlers throw an `ApiError`; a single catch site calls `toErrorBody`
 * to turn anything thrown — ours or not — into a status, a JSON body and any
 * headers the response needs. Nothing here imports Next, so it stays unit
 * testable under plain node.
 */

/** The stable set of machine-readable error codes clients may branch on. */
export type ApiErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'validation_failed'
  | 'rate_limited'
  | 'not_found'
  | 'method_not_allowed'
  | 'conflict'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'upstream_unavailable'
  | 'internal';

/**
 * The brand that marks an `ApiError` across module boundaries.
 *
 * `Symbol.for` reads the process-wide symbol registry, so duplicate copies of
 * this module (bundler boundaries, mixed ESM/CJS) all mint the *same* symbol
 * even though each has its own `ApiError` prototype. That is exactly the
 * failure `instanceof` does not survive, and it is why the brand replaces the
 * old structural fallback — which accepted any object carrying a numeric
 * `status` and a string `code`, ours or not.
 */
const API_ERROR_BRAND: unique symbol = Symbol.for('zentra.apiError');

/** An error carrying the HTTP status and client-safe code for a failed request. */
export class ApiError extends Error {
  readonly [API_ERROR_BRAND] = true;
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: Record<string, string>;
  readonly retryAfterSeconds?: number;
  readonly allowedMethods?: string[];

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    options?: {
      details?: Record<string, string>;
      retryAfterSeconds?: number;
      allowedMethods?: string[];
    },
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = options?.details;
    this.retryAfterSeconds = options?.retryAfterSeconds;
    this.allowedMethods = options?.allowedMethods;
    // Keeps `instanceof` working when TypeScript downlevels the class.
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

/** 400 — the request itself was malformed or unusable. */
export function badRequest(message: string): ApiError {
  return new ApiError(400, 'bad_request', message);
}

/** 401 — no usable credential was presented. */
export function unauthorized(message: string): ApiError {
  return new ApiError(401, 'unauthorized', message);
}

/** 403 — a credential was presented and it was not accepted. */
export function forbidden(message: string): ApiError {
  return new ApiError(403, 'forbidden', message);
}

/** 422 — the request parsed but individual fields failed validation. */
export function validationFailed(details: Record<string, string>): ApiError {
  return new ApiError(422, 'validation_failed', 'Validation failed.', {
    details,
  });
}

/** 429 — the caller exceeded its rate limit and should retry later. */
export function rateLimited(retryAfterSeconds: number): ApiError {
  return new ApiError(429, 'rate_limited', 'Too many requests.', {
    retryAfterSeconds,
  });
}

/** 404 — the resource the request names does not exist. */
export function notFound(message: string): ApiError {
  return new ApiError(404, 'not_found', message);
}

/**
 * 405 — the endpoint exists but does not serve this HTTP method.
 *
 * Carries the methods it does serve, which `toErrorBody` surfaces as the
 * `Allow` header RFC 9110 requires a 405 to send.
 */
export function methodNotAllowed(allowedMethods: string[]): ApiError {
  return new ApiError(405, 'method_not_allowed', 'Method not allowed.', {
    allowedMethods,
  });
}

/** 409 — the request collided with a row that already exists. */
export function conflict(message: string): ApiError {
  return new ApiError(409, 'conflict', message);
}

/** 413 — the request body exceeded the byte ceiling for this route. */
export function payloadTooLarge(maxBytes: number): ApiError {
  return new ApiError(
    413,
    'payload_too_large',
    `Request body exceeds the ${maxBytes} byte limit.`,
  );
}

/**
 * 415 — the body was not sent as the media type this route parses.
 *
 * Separate from `bad_request` because the fix is different: the payload may be
 * perfectly good and only the header wrong, and a client that branches on the
 * code can correct the request rather than the data.
 */
export function unsupportedMediaType(expected: string): ApiError {
  return new ApiError(
    415,
    'unsupported_media_type',
    `Request body must be sent as ${expected}.`,
  );
}

/** 503 — a dependency we call out to is down or unreachable. */
export function upstreamUnavailable(message: string): ApiError {
  return new ApiError(503, 'upstream_unavailable', message);
}

/**
 * Whether `value` is an `ApiError`, detected by its registry-symbol brand.
 *
 * Duplicate copies of this module (bundler boundaries, mixed ESM/CJS) break
 * `instanceof`, which is why detection cannot rely on the prototype. The brand
 * survives that duplication — every copy asks `Symbol.for` for the same key —
 * so no looser structural check is needed, and an arbitrary object that merely
 * looks like an `ApiError` is no longer mistaken for one.
 */
export function isApiError(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null) return false;
  return (value as Record<PropertyKey, unknown>)[API_ERROR_BRAND] === true;
}

/**
 * Turn any thrown value into the status, JSON body and headers to respond with.
 *
 * Unknown errors collapse to a generic 500: their message and stack may carry
 * connection strings or query fragments, so they are never sent to the client.
 */
export function toErrorBody(error: unknown): {
  status: number;
  body: {
    error: { code: ApiErrorCode; message: string; details?: Record<string, string> };
  };
  headers: Record<string, string>;
} {
  if (!isApiError(error)) {
    return {
      status: 500,
      body: { error: { code: 'internal', message: 'Internal server error.' } },
      headers: {},
    };
  }

  const headers: Record<string, string> = {};
  if (typeof error.retryAfterSeconds === 'number') {
    headers['Retry-After'] = String(error.retryAfterSeconds);
  }
  if (error.allowedMethods !== undefined && error.allowedMethods.length > 0) {
    headers.Allow = error.allowedMethods.join(', ');
  }

  return {
    status: error.status,
    body: {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    },
    headers,
  };
}
