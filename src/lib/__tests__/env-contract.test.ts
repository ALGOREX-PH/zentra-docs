import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * .env.example calls itself "the contract between the code and whoever has to
 * run it": every variable the code reads is listed there, and nothing else is.
 * This test pins that claim so a new `process.env` lookup (or a deleted one)
 * cannot drift away from the file silently.
 */

const ROOT = join(__dirname, '..', '..', '..');
const SRC = join(ROOT, 'src');

/** Every non-test TypeScript source file under src/. */
function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter(
      (file) =>
        /\.tsx?$/.test(file) &&
        !file.endsWith('.d.ts') &&
        !/\.test\.tsx?$/.test(file) &&
        !file.includes('__tests__'),
    );
}

/**
 * Env names referenced by the source tree.
 *
 * Two shapes count. Literal `process.env.X` lookups are scanned directly.
 * Computed lookups — `process.env[SOME_ENV]`, which Next.js cannot inline and
 * the literal scan cannot see — are declared in this codebase as exported
 * `*_ENV = '<name>'` constants, so the constant declarations are scanned for
 * their string values:
 *
 *   src/lib/api/auth.ts            ADMIN_TOKEN_ENV        = 'ADMIN_TOKEN'
 *   src/lib/api/sponsor.ts         SPONSOR_SECRET_ENV     = 'SPONSOR_SECRET'
 *   src/lib/api/sponsor-budget.ts  SOURCE_BUDGET_XLM_ENV  = 'SPONSOR_DAILY_SOURCE_BUDGET_XLM'
 *                                  GLOBAL_BUDGET_XLM_ENV  = 'SPONSOR_DAILY_GLOBAL_BUDGET_XLM'
 *                                  BUDGET_ENFORCEMENT_ENV = 'SPONSOR_BUDGET_ENFORCE'
 *   src/config/network.ts          NETWORK_ENV            = 'NEXT_PUBLIC_STELLAR_NETWORK'
 */
function referencedEnvNames(): Set<string> {
  const names = new Set<string>();
  for (const file of sourceFiles()) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      names.add(match[1] as string);
    }
    for (const match of text.matchAll(/[A-Z][A-Z0-9_]*_ENV\s*=\s*'([A-Z][A-Z0-9_]*)'/g)) {
      names.add(match[1] as string);
    }
  }
  return names;
}

const exampleText = readFileSync(join(ROOT, '.env.example'), 'utf8');

/** Variables .env.example declares as fill-in lines (`NAME=` at column 0). */
function declaredInExample(): Set<string> {
  const names = new Set<string>();
  for (const match of exampleText.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)) {
    names.add(match[1] as string);
  }
  return names;
}

/**
 * Platform-set variables (NODE_ENV, VERCEL_*) are documented in the "set for
 * you" comment block rather than as fill-in lines, so "listed" means the name
 * appears anywhere in the file.
 */
function mentionedInExample(name: string): boolean {
  return exampleText.includes(name);
}

/**
 * Known drift, pinned rather than papered over: sponsor-budget.ts reads these
 * three variables, but .env.example does not document them yet. Fix by adding
 * them to .env.example, then deleting them from this list — the ratchet test
 * below fails the moment either side changes, so the exception cannot outlive
 * the problem or hide a new one.
 */
const KNOWN_UNDOCUMENTED = [
  'SPONSOR_DAILY_SOURCE_BUDGET_XLM',
  'SPONSOR_DAILY_GLOBAL_BUDGET_XLM',
  'SPONSOR_BUDGET_ENFORCE',
];

describe('the .env.example contract', () => {
  it('finds the known lookups, so the scan itself is not silently broken', () => {
    const referenced = referencedEnvNames();
    for (const name of [
      'DATABASE_URL',
      'NEXT_PUBLIC_STELLAR_NETWORK',
      'NEXT_PUBLIC_SITE_URL',
      'ADMIN_TOKEN',
      'SPONSOR_SECRET',
      'NODE_ENV',
      'VERCEL_PROJECT_PRODUCTION_URL',
    ]) {
      expect(referenced, `expected the source scan to find ${name}`).toContain(name);
    }
  });

  it('documents every variable the source tree reads', () => {
    const undocumented = [...referencedEnvNames()]
      .filter((name) => !mentionedInExample(name))
      .filter((name) => !KNOWN_UNDOCUMENTED.includes(name))
      .sort();
    expect(
      undocumented,
      'these env vars are read by src/ but missing from .env.example — add them there',
    ).toEqual([]);
  });

  it('lists nothing the source tree does not read', () => {
    const referenced = referencedEnvNames();
    const unreferenced = [...declaredInExample()].filter((name) => !referenced.has(name)).sort();
    expect(
      unreferenced,
      'these env vars are declared in .env.example but never read by src/ — remove them',
    ).toEqual([]);
  });

  it('keeps the known-drift list honest', () => {
    const referenced = referencedEnvNames();
    for (const name of KNOWN_UNDOCUMENTED) {
      expect(
        referenced.has(name),
        `${name} is no longer read by src/ — remove it from KNOWN_UNDOCUMENTED`,
      ).toBe(true);
      expect(
        mentionedInExample(name),
        `${name} is now documented in .env.example — remove it from KNOWN_UNDOCUMENTED`,
      ).toBe(false);
    }
  });
});
