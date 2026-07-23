/**
 * Browser-side helpers for reading responses from the JSON API.
 *
 * Every route answers a failure with the same envelope, so the components that
 * call them should not each re-implement the unwrapping — and must not assume
 * the body is well formed, since a proxy, a cold start or an edge error page
 * can all return something else entirely.
 */

/** The failure envelope every API route returns, as seen by the client. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, string>;
  };
}

/** Whether `value` is shaped like the API failure envelope. */
export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const { error } = value as { error?: unknown };
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return typeof code === 'string' && typeof message === 'string';
}

/**
 * Extract a human-readable message from a failed response.
 *
 * Field-level `details` are appended after the summary so a 422 tells the user
 * which input to fix rather than just that something was wrong. Falls back to
 * `fallback` for any body that is not the envelope — including empty bodies and
 * HTML error pages — and never throws, so it is safe to await inside a `catch`.
 */
export async function readApiError(response: Response, fallback: string): Promise<string> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return fallback;
  }

  if (!isApiErrorBody(body)) return fallback;

  const { message, details } = body.error;
  const fields = details ? Object.values(details) : [];
  return fields.length > 0 ? `${message} ${fields.join(' ')}`.trim() : message;
}
