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
 * The schema these queries assume lives in `db/schema.sql`.
 */
let cached: ReturnType<typeof neon> | null = null;

/** Connection string schemes the Neon driver accepts. */
const VALID_SCHEME = /^postgres(ql)?:\/\//;

/**
 * Return the shared SQL client, creating it on first use.
 *
 * Throws when `DATABASE_URL` is missing or is not a Postgres URL. The error
 * deliberately never quotes the value: it is a credential, and this message
 * reaches the server log. Callers convert the throw into a 503 rather than
 * letting it reach the client.
 */
export function sql() {
  if (cached) return cached;

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');
  if (!VALID_SCHEME.test(url)) {
    throw new Error('DATABASE_URL is not a postgres:// connection string.');
  }

  cached = neon(url);
  return cached;
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
