import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GLOBAL_BUDGET_XLM_ENV,
  reserveSponsorBudget,
  SOURCE_BUDGET_XLM_ENV,
} from '@/lib/api/sponsor-budget';

/**
 * The mocked unit tests beside this file verify the statement's *shape*; these
 * run the real thing against real Postgres (PGlite is Postgres compiled to
 * WASM), with the schema applied verbatim from `db/schema.sql`.
 *
 * Doing so exposed a genuine bug on first landing: the statement originally
 * ended `... RETURNING budget_scope UNION ALL SELECT ...`, which PostgreSQL
 * rejects (`INSERT ... RETURNING` cannot participate in a set operation), so
 * every reservation reported `ledger_unavailable`. The mocked tests never
 * executed the SQL and could not see it. The statement now uses two CTEs and
 * a plain SELECT union; the suite below verifies the full intended contract
 * against the real parser and executor.
 */

const ACCOUNT_A = `G${'A'.repeat(55)}`;
const ACCOUNT_B = `G${'B'.repeat(55)}`;
const ACCOUNT_C = `G${'C'.repeat(55)}`;

/** The application schema, applied verbatim — the same file production runs. */
const SCHEMA = readFileSync(
  fileURLToPath(new URL('../../../../db/schema.sql', import.meta.url)),
  'utf8',
);

let db: PGlite;

/**
 * Adapt the module's tagged-template query seam onto PGlite: template slots
 * become numbered parameters, and the rows come back as the one column the
 * statement returns. Nothing about the SQL text is altered.
 */
function pgliteQuery(strings: TemplateStringsArray, ...values: unknown[]) {
  let text = strings[0] ?? '';
  for (let i = 1; i < strings.length; i += 1) {
    text += `$${i}${strings[i]}`;
  }
  return db
    .query(text, values as unknown[])
    .then((result) => result.rows as Array<{ budget_scope: 'source' | 'global' }>);
}

/** Charge `feeStroops` against `sourceAccount` through the real statement. */
function reserve(sourceAccount: string, feeStroops: number, now?: Date) {
  return reserveSponsorBudget({ sourceAccount, feeStroops, now, query: pgliteQuery });
}

/** What the ledger holds for one (scope, account), or null when no row. */
async function spent(scope: 'source' | 'global', account: string): Promise<number | null> {
  const result = await db.query(
    `SELECT spent_stroops::text AS spent FROM sponsor_spend
     WHERE budget_scope = $1 AND source_account = $2`,
    [scope, account],
  );
  const row = result.rows[0] as { spent: string } | undefined;
  return row ? Number(row.spent) : null;
}

async function rowCount(): Promise<number> {
  const result = await db.query('SELECT count(*)::int AS count FROM sponsor_spend');
  return (result.rows[0] as { count: number }).count;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec('DELETE FROM sponsor_spend');
  // 500 stroops per source per day, 1000 stroops globally, unless overridden.
  vi.stubEnv(SOURCE_BUDGET_XLM_ENV, '0.00005');
  vi.stubEnv(GLOBAL_BUDGET_XLM_ENV, '0.0001');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('reserveSponsorBudget against real Postgres', () => {
  it('parses and executes cleanly — the statement is valid Postgres', async () => {
    // Pins the class of bug this suite exists for: the original form was a
    // syntax error on every execution, invisible to the mocked tests.
    const result = await reserve(ACCOUNT_A, 100);

    expect(result).toEqual({ ok: true });
    expect(await rowCount()).toBe(2);
  });

  it('reports a broken ledger as unavailable rather than throwing', async () => {
    const result = await reserveSponsorBudget({
      sourceAccount: ACCOUNT_A,
      feeStroops: 100,
      query: () =>
        db
          .query('SELECT * FROM missing_table')
          .then((r) => r.rows as Array<{ budget_scope: 'source' | 'global' }>),
    });

    expect(result).toMatchObject({ ok: false, reason: 'ledger_unavailable' });
  });
});

/** The contract the statement enforces, executed against real Postgres. */
describe('reserveSponsorBudget contract', () => {
  it('refuses the first charge of the day when it alone exceeds the source ceiling', async () => {
    // The INSERT branch, not the UPDATE branch: no row exists yet, so only
    // an `INSERT ... SELECT ... WHERE fee <= ceiling` can refuse this — the
    // exact case a bare `VALUES` insert would let through.
    const result = await reserve(ACCOUNT_A, 501);

    expect(result).toEqual({ ok: false, reason: 'source_budget_exceeded' });
    // Nothing landed — not the source row, and not the gated global one.
    expect(await rowCount()).toBe(0);
  });

  it('charges the first under-ceiling reservation on both rows', async () => {
    const result = await reserve(ACCOUNT_A, 400);

    expect(result).toEqual({ ok: true });
    expect(await spent('source', ACCOUNT_A)).toBe(400);
    expect(await spent('global', '')).toBe(400);
    expect(await rowCount()).toBe(2);
  });

  it('accumulates charges until one would bust the ceiling, then refuses it', async () => {
    expect(await reserve(ACCOUNT_A, 200)).toEqual({ ok: true });
    expect(await reserve(ACCOUNT_A, 200)).toEqual({ ok: true });

    // 400 + 200 would land at 600 against a 500 ceiling.
    const refused = await reserve(ACCOUNT_A, 200);

    expect(refused).toEqual({ ok: false, reason: 'source_budget_exceeded' });
    // The refused attempt charged neither ledger: the source row held at 400,
    // and the gated global insert never fired.
    expect(await spent('source', ACCOUNT_A)).toBe(400);
    expect(await spent('global', '')).toBe(400);
  });

  it('lets a later charge that still fits land after a refusal', async () => {
    expect(await reserve(ACCOUNT_A, 400)).toEqual({ ok: true });
    expect(await reserve(ACCOUNT_A, 200)).toMatchObject({ ok: false });

    // 400 + 100 fits; the earlier refusal must not have poisoned the window.
    expect(await reserve(ACCOUNT_A, 100)).toEqual({ ok: true });
    expect(await spent('source', ACCOUNT_A)).toBe(500);
  });

  it('refuses on the global ceiling with the residual source charge recorded', async () => {
    expect(await reserve(ACCOUNT_A, 500)).toEqual({ ok: true });
    expect(await reserve(ACCOUNT_B, 500)).toEqual({ ok: true });

    // Global now sits at 1000, its exact ceiling; the next source has budget
    // of its own but the deployment does not.
    const refused = await reserve(ACCOUNT_C, 500);

    expect(refused).toEqual({ ok: false, reason: 'global_budget_exceeded' });
    // The module's documented residual: the source charge gates the global
    // one, so a globally-refused request still consumed its own source budget
    // — over-counting confined to the caller, which is self-limiting.
    expect(await spent('source', ACCOUNT_C)).toBe(500);
    expect(await spent('global', '')).toBe(1000);
  });

  it('meters each source separately while they share the global row', async () => {
    expect(await reserve(ACCOUNT_A, 300)).toEqual({ ok: true });
    expect(await reserve(ACCOUNT_B, 300)).toEqual({ ok: true });

    expect(await spent('source', ACCOUNT_A)).toBe(300);
    expect(await spent('source', ACCOUNT_B)).toBe(300);
    expect(await spent('global', '')).toBe(600);
  });

  it('admits exactly the reservations that fit under contention', async () => {
    // Ten rivals of 100 stroops against a 500-stroop ceiling, issued
    // together. However they interleave, exactly five fit and five cannot —
    // the per-row serialisation ON CONFLICT provides in production.
    const attempts = await Promise.all(Array.from({ length: 10 }, () => reserve(ACCOUNT_A, 100)));

    expect(attempts.filter((result) => result.ok)).toHaveLength(5);
    expect(attempts.filter((result) => !result.ok)).toHaveLength(5);
    expect(await spent('source', ACCOUNT_A)).toBe(500);
  });

  it('opens a fresh budget at UTC midnight, keyed by spend_day', async () => {
    const before = new Date('2026-07-30T23:59:59.999Z');
    const after = new Date('2026-07-31T00:00:00.000Z');

    expect(await reserve(ACCOUNT_A, 500, before)).toEqual({ ok: true });
    expect(await reserve(ACCOUNT_A, 500, before)).toMatchObject({ ok: false });

    // One millisecond later by the wall clock, a whole new ledger row.
    expect(await reserve(ACCOUNT_A, 500, after)).toEqual({ ok: true });

    const days = await db.query(
      `SELECT spend_day::text AS day FROM sponsor_spend
       WHERE budget_scope = 'source' ORDER BY spend_day`,
    );
    expect(days.rows).toEqual([{ day: '2026-07-30' }, { day: '2026-07-31' }]);
  });
});
