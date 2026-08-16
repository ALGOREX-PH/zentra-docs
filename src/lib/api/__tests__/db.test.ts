import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasDatabase, sql } from '@/lib/db';

/** A syntactically fine connection string carrying an obvious credential. */
const URL_A = 'postgres://app:hunter2@db.example.neon.tech/zentra';
const URL_B = 'postgres://app:rotated@db.example.neon.tech/zentra';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('sql', () => {
  it('throws when DATABASE_URL is not set', () => {
    vi.stubEnv('DATABASE_URL', undefined);

    expect(() => sql()).toThrow('DATABASE_URL is not set.');
  });

  it('throws when DATABASE_URL is not a postgres connection string', () => {
    for (const url of ['mysql://app:pw@host/db', 'https://example.com', 'not-a-url', 'postgres']) {
      vi.stubEnv('DATABASE_URL', url);

      expect(() => sql()).toThrow('DATABASE_URL is not a postgres:// connection string.');
    }
  });

  it('never quotes the credential in either failure message', () => {
    // The message reaches the server log, and the value is a credential.
    vi.stubEnv('DATABASE_URL', 'mysql://app:hunter2@host/db');

    let caught: unknown;
    try {
      sql();
    } catch (error) {
      caught = error;
    }

    const message = String((caught as Error).message);
    expect(message).not.toContain('hunter2');
    expect(message).not.toContain('mysql');
    expect(message).not.toContain('host');
  });

  it('accepts both postgres:// and postgresql:// schemes', () => {
    vi.stubEnv('DATABASE_URL', URL_A);
    expect(() => sql()).not.toThrow();

    vi.stubEnv('DATABASE_URL', URL_A.replace('postgres://', 'postgresql://'));
    expect(() => sql()).not.toThrow();
  });

  it('caches the client per connection-string value', () => {
    vi.stubEnv('DATABASE_URL', URL_A);

    expect(sql()).toBe(sql());
  });

  it('rebuilds the client when DATABASE_URL changes, so a rotation takes effect', () => {
    vi.stubEnv('DATABASE_URL', URL_A);
    const before = sql();

    vi.stubEnv('DATABASE_URL', URL_B);
    const after = sql();

    // A warm instance must not keep signing with the retired credential.
    expect(after).not.toBe(before);
    // And swapping back re-parses again rather than resurrecting the old one:
    // the cache holds exactly one entry, keyed on the current value.
    vi.stubEnv('DATABASE_URL', URL_A);
    expect(sql()).not.toBe(before);
  });
});

describe('hasDatabase', () => {
  it('is false when DATABASE_URL is not set', () => {
    vi.stubEnv('DATABASE_URL', undefined);

    expect(hasDatabase()).toBe(false);
  });

  it('is false when DATABASE_URL is blank or not a postgres URL', () => {
    for (const url of ['', '   ', 'mysql://app:pw@host/db', 'https://example.com']) {
      vi.stubEnv('DATABASE_URL', url);

      expect(hasDatabase()).toBe(false);
    }
  });

  it('is true for a postgres URL without connecting to it', () => {
    vi.stubEnv('DATABASE_URL', URL_A);

    expect(hasDatabase()).toBe(true);
  });
});
