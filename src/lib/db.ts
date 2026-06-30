import { neon } from '@neondatabase/serverless';

/**
 * Lazily-created Neon (serverless Postgres) SQL client.
 *
 * `DATABASE_URL` is read at call time, not import time, so the module can be
 * imported during the build even when the env var is absent — only the feedback
 * API route actually invokes it at request time.
 */
let cached: ReturnType<typeof neon> | null = null;

export function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');
  if (!cached) cached = neon(url);
  return cached;
}
