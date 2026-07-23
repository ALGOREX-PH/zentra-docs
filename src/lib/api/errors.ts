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
  | 'upstream_unavailable'
  | 'internal';

/** An error carrying the HTTP status and client-safe code for a failed request. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: Record<string, string>;
  readonly retryAfterSeconds?: number;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    options?: { details?: Record<string, string>; retryAfterSeconds?: number },
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = options?.details;
    this.retryAfterSeconds = options?.retryAfterSeconds;
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

/** 503 — a dependency we call out to is down or unreachable. */
export function upstreamUnavailable(message: string): ApiError {
  return new ApiError(503, 'upstream_unavailable', message);
}

/**
 * Whether `value` is an `ApiError`, structurally as well as by prototype.
 *
 * Duplicate copies of this module (bundler boundaries, mixed ESM/CJS) break
 * `instanceof`, so an object shaped like an `ApiError` is accepted too.
 */
export function isApiError(value: unknown): value is ApiError {
  if (value instanceof ApiError) return true;
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { status?: unknown; code?: unknown };
  return typeof candidate.status === 'number' && typeof candidate.code === 'string';
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

  const headers: Record<string, string> =
    typeof error.retryAfterSeconds === 'number'
      ? { 'Retry-After': String(error.retryAfterSeconds) }
      : {};

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
