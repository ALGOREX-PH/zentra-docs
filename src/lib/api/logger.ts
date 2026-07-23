/**
 * Structured, single-line JSON logging for API routes.
 *
 * Vercel's log drain parses one JSON object per line, so every entry is
 * serialised to a single string and handed to the matching console method.
 * Zero dependencies and no framework imports, so this stays unit-testable in a
 * plain node environment.
 */

/** Severity of a log entry, ordered from most to least verbose. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Arbitrary structured context merged into the emitted JSON object. */
export interface LogFields {
  [key: string]: unknown;
}

/** Keys whose values are never safe to write to a log drain. */
const SENSITIVE_KEY =
  /(secret|token|password|key|authorization|cookie|database_url|connection)/i;

/** Placeholder substituted for any value under a sensitive key. */
const REDACTED = '[redacted]';

/** True when running under a production build, where debug output is dropped. */
function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Emit one line of JSON at the given level, with `fields` redacted and merged in.
 *
 * Shape is `{"ts":"<ISO8601>","level":"info","event":"<event>", ...fields}`.
 * `debug` entries are suppressed in production. Serialisation never throws: a
 * failure falls back to a minimal line carrying `serializationError: true`.
 */
export function log(level: LogLevel, event: string, fields?: LogFields): void {
  if (level === 'debug' && isProduction()) return;

  const ts = new Date().toISOString();
  const write = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

  let line: string;
  try {
    const safe = normalise(redact(fields ?? {}));
    line = JSON.stringify({ ts, level, event, ...safe });
  } catch {
    line = JSON.stringify({ ts, level, event, serializationError: true });
  }

  write(line);
}

/**
 * Generate a request correlation id, preferring `crypto.randomUUID()`.
 *
 * Access to the global crypto object is guarded so it cannot throw on runtimes
 * that omit it; those fall back to a short base36 id from the clock plus noise.
 */
export function newRequestId(): string {
  try {
    const uuid = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.();
    if (uuid) return uuid;
  } catch {
    // Fall through to the non-crypto id below.
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Return a shallow copy of `fields` with values under sensitive keys masked.
 *
 * Matching is by key name only, so nested objects are left untouched — keep
 * credentials at the top level of the fields you log.
 */
export function redact(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const key of Object.keys(fields)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : fields[key];
  }
  return out;
}

/**
 * Replace `Error` values with a plain `{ name, message }` object (plus `stack`
 * outside production) so `JSON.stringify` does not silently drop them.
 */
function normalise(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const key of Object.keys(fields)) {
    const value = fields[key];
    if (value instanceof Error) {
      out[key] = isProduction()
        ? { name: value.name, message: value.message }
        : { name: value.name, message: value.message, stack: value.stack };
    } else {
      out[key] = value;
    }
  }
  return out;
}
