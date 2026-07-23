/**
 * Operator-only moderation switch for a single feedback row.
 *
 * This route exists because an abusive submission reached the public feed and
 * there was no way to take it down short of a `DELETE` against production. That
 * is the wrong tool twice over: it destroys the evidence of the abuse, and it
 * silently changes the totals the dashboard reports. `PATCH` here flips the
 * `hidden` flag instead, so the row stops being served to the public while
 * remaining on record — reversible, auditable, and never a data loss.
 *
 * The gate is `requireAdmin` and it runs before the body is even read. Hiding
 * and unhiding are the same operation with a different boolean, so an operator
 * who over-corrects can undo it with one more call.
 */

import { requireAdmin } from '@/lib/api/auth';
import { ApiError, badRequest, upstreamUnavailable, validationFailed } from '@/lib/api/errors';
import { log } from '@/lib/api/logger';
import { json, route } from '@/lib/api/route';
import { readJsonBody } from '@/lib/api/validation';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A moderation request after validation — exactly the fields we act on. */
interface ModerationInput {
  id: number;
  hidden: boolean;
}

export const PATCH = route('admin.feedback.moderate', async (request, { requestId }) => {
  requireAdmin(request, requestId);

  const { id, hidden } = parseModerationInput(await readJsonBody(request));
  await setHidden(id, hidden, requestId);

  // The row id and the new state are operational facts, not user content, so
  // logging them gives the audit trail without repeating what was submitted.
  log('info', 'admin.feedback.moderated', { requestId, id, hidden });

  return json({ ok: true, id, hidden });
});

/**
 * Validate a decoded request body into a `ModerationInput`.
 *
 * Accumulates every field error before throwing, so an operator scripting
 * against this endpoint learns everything wrong with their payload at once.
 */
function parseModerationInput(raw: unknown): ModerationInput {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw badRequest('Request body must be a JSON object.');
  }

  const body = raw as Record<string, unknown>;
  const details: Record<string, string> = {};

  // `id` is a bigint identity column. Anything past 2^53 cannot survive the
  // round trip through JSON as a number, so it is rejected here rather than
  // matching some other row after the engine rounds it.
  const id = body.id;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) {
    details.id = 'Id must be a positive integer.';
  }

  // Strictly a boolean, not anything truthy: `"false"` is a string and would
  // hide a row an operator meant to restore.
  const hidden = body.hidden;
  if (typeof hidden !== 'boolean') {
    details.hidden = 'Hidden must be a boolean.';
  }

  if (Object.keys(details).length > 0) {
    throw validationFailed(details);
  }

  return { id: id as number, hidden: hidden as boolean };
}

/** Set `hidden` on one feedback row, or raise a 404 when no such row exists. */
async function setHidden(id: number, hidden: boolean, requestId: string): Promise<void> {
  const db = sql();

  let rows: unknown[];
  try {
    // Neon's HTTP driver hands back rows rather than a command tag, so a bare
    // UPDATE gives no way to tell "flag changed" from "no such id". `RETURNING
    // id` turns the outcome into something countable: one row means it matched.
    rows = (await db`
      UPDATE feedback
      SET hidden = ${hidden}
      WHERE id = ${id}
      RETURNING id
    `) as unknown as unknown[];
  } catch (error) {
    // Driver messages routinely quote the failing statement and the connection
    // target, so the operator gets the log line and the caller gets nothing.
    log('error', 'admin.feedback.write', { requestId, id, err: error });
    throw upstreamUnavailable('Feedback storage is temporarily unavailable.');
  }

  // Thrown outside the `try` on purpose: a not-found is a client-side mistake
  // and must not be swallowed by the storage-failure handler above.
  if (rows.length === 0) {
    throw new ApiError(404, 'not_found', 'No feedback row with that id.');
  }
}
