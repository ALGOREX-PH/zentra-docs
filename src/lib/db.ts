import { neon } from '@neondatabase/serverless';

/**
 * Lazily-created Neon (serverless Postgres) SQL client.
 *
 * `DATABASE_URL` is read at call time rather than import time, so this module
 * can be imported during the build even when the variable is absent — only the
 * API routes actually invoke it, and only while serving a request.
 *
 * The client speaks Neon's HTTP driver, so there is no connection pool to size
 * or drain: each tagged query is one stateless HTTPS round trip, which is what
 * makes it safe in a serverless function that may be frozen between requests.
 * The instance is still cached because building it parses the URL and sets up
 * the fetch wrapper, and there is no reason to repeat that per request.
 *
 * The cache is keyed on the connection string's value, not on "have we built
 * one yet": a rotated `DATABASE_URL` (a credential swap after a suspected
 * leak, a branch promotion) then takes effect on the next request, instead of
 * a warm instance keeping the retired credential in play until it happens to
 * scale to zero. Comparing one string per call is free next to the HTTPS round
 * trip that follows it, and construction stays lazy either way.
 *
 * The schema these queries assume lives in `db/schema.sql`.
 */
let cached: { url: string; client: ReturnType<typeof neon> } | null = null;

/** Connection string schemes the Neon driver accepts. */
const VALID_SCHEME = /^postgres(ql)?:\/\//;

/**
 * Return the shared SQL client, creating it on first use and re-creating it
 * whenever `DATABASE_URL` has changed since the last call.
 *
 * Throws when `DATABASE_URL` is missing or is not a Postgres URL. The error
 * deliberately never quotes the value: it is a credential, and this message
 * reaches the server log. Callers convert the throw into a 503 rather than
 * letting it reach the client.
 */
export function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');
  if (!VALID_SCHEME.test(url)) {
    throw new Error('DATABASE_URL is not a postgres:// connection string.');
  }

  if (cached === null || cached.url !== url) {
    cached = { url, client: neon(url) };
  }
  return cached.client;
}

/**
 * Run one tagged-template query and hand the rows back as `T[]`.
 *
 *     const rows = await query<{ count: number }>`SELECT count(*)::int AS count FROM users`;
 *
 * The Neon driver types every result as a broad union of row shapes, so each
 * call site was asserting its own shape with a private `as unknown as` pair.
 * This wrapper is where that cast lives — once, audited — and the type
 * parameter is where a caller states what its statement actually selects. The
 * assertion is exactly as trustworthy as the SQL beside it: the driver cannot
 * verify it, so a statement and its `T` must be reviewed together.
 */
export function query<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> {
  return sql()(strings, ...values) as unknown as Promise<T[]>;
}

/**
 * Whether a database is configured, without connecting to it.
 *
 * Lets a caller choose to degrade — rendering an empty state instead of an
 * error — when the deployment simply has no database wired up, which is a
 * different situation from one that is wired up and failing.
 */
export function hasDatabase(): boolean {
  const url = process.env.DATABASE_URL;
  return typeof url === 'string' && VALID_SCHEME.test(url);
}
