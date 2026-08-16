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

/** Keys whose values are never safe to write to a log drain, at any depth. */
const SENSITIVE_KEY =
  /(secret|token|password|key|authorization|cookie|database_url|connection)/i;

/**
 * Whether `key` carries personal data. Applied only below the top level.
 *
 * Top-level fields are operational metadata this codebase chooses deliberately —
 * `route()` logs the operation under `name`, next to `method` and `status`. Only
 * nested structures are payloads we are dumping wholesale, where a `name` or
 * `email` is a person rather than a route.
 *
 * `email` matches anywhere in the key (`userEmail`, `email_address`). `name`
 * must match as a whole *segment* of the key, not as a substring or a
 * `\b`-bounded word: `fullName`, `firstName` and `user_name` all name a person
 * — and `\bname\b` saw none of them, because a camel hump and an underscore
 * are both word characters — while `hostname`, `filename` and `nickname` do
 * not and must stay readable. Splitting the key at its snake/kebab/camel
 * boundaries is what tells those two groups apart.
 */
function isPiiKey(key: string): boolean {
  if (/email/i.test(key)) return true;
  return keySegments(key).some((segment) => segment.toLowerCase() === 'name');
}

/**
 * Split a key at separator boundaries (`_`, `-`, `.`, space), then at camel
 * humps. The hump split requires a lowercase-to-uppercase transition, so an
 * all-caps key such as `NAME` stays one segment rather than four letters.
 */
function keySegments(key: string): string[] {
  return key.split(/[_\s.-]+/).flatMap((part) => part.split(/(?<=[a-z0-9])(?=[A-Z])/));
}

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
 * Return a copy of `fields` with values under sensitive keys masked.
 *
 * Matching is by key name, applied recursively through plain objects and arrays
 * so a credential nested inside a request or config payload is masked too.
 * `Error` values are left for `normalise`, which scrubs them separately.
 */
export function redact(fields: LogFields, depth = 0): LogFields {
  const out: LogFields = {};
  for (const key of Object.keys(fields)) {
    const masked = SENSITIVE_KEY.test(key) || (depth > 0 && isPiiKey(key));
    out[key] = masked ? REDACTED : redactValue(fields[key], depth);
  }
  return out;
}

/** Recurse through plain containers, leaving `Error` and exotic objects alone. */
function redactValue(value: unknown, depth: number): unknown {
  if (value instanceof Error) return value;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  if (value !== null && typeof value === 'object' && isPlainObject(value)) {
    return redact(value as LogFields, depth + 1);
  }
  return value;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Credentials embedded in a connection URI, e.g. `postgres://user:password@host`.
 *
 * Driver errors routinely quote the whole DSN back in their message and stack,
 * which would otherwise write the database password straight to the log drain.
 */
const EMBEDDED_CREDENTIAL = /\/\/[^\s/@]+:[^\s/@]+@/;

/**
 * Replace `Error` values with a plain `{ name, message }` object (plus `stack`
 * outside production) so `JSON.stringify` does not silently drop them.
 *
 * A message carrying an embedded credential is masked entirely and its stack is
 * dropped, since the same URI is usually repeated in every frame.
 */
function normalise(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const key of Object.keys(fields)) {
    const value = fields[key];
    if (value instanceof Error) {
      if (EMBEDDED_CREDENTIAL.test(value.message) || EMBEDDED_CREDENTIAL.test(value.stack ?? '')) {
        out[key] = { name: value.name, message: REDACTED };
      } else {
        out[key] = isProduction()
          ? { name: value.name, message: value.message }
          : { name: value.name, message: value.message, stack: value.stack };
      }
    } else {
      out[key] = value;
    }
  }
  return out;
}
