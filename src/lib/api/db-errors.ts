/**
 * Shared translation of database failures into the API's error vocabulary.
 *
 * Every route that touches Postgres asks the same two questions of a caught
 * error — "is this the unique violation my index raises?" and "how do I refuse
 * without leaking the driver's message?" — and each was answering them with a
 * private copy of the same code. One module means one place where the SQLSTATE
 * lives and one place that guarantees the leak-prevention below actually
 * happens on every route.
 */

import { upstreamUnavailable, type ApiError } from '@/lib/api/errors';
import { log } from '@/lib/api/logger';

/** Postgres unique-violation SQLSTATE, raised by every unique index we define. */
export const UNIQUE_VIOLATION = '23505';

/** Whether `error` is the Postgres unique-violation a unique index raises. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

/**
 * Log the real database failure and return the error to send in its place.
 *
 * Driver messages routinely quote the failing statement and the connection
 * target — and the statement can carry the submission itself — so the client
 * only ever learns the route's own `message`. The underlying cause goes to the
 * log at `error` level under `event`, where the logger's redaction applies.
 */
export function storageUnavailable(error: unknown, event: string, message: string): ApiError {
  log('error', event, { err: error });
  return upstreamUnavailable(message);
}
