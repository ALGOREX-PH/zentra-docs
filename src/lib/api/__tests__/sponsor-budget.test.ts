import { afterEach, describe, expect, it } from 'vitest';

import {
  BUDGET_ENFORCEMENT_ENV,
  GLOBAL_BUDGET_XLM_ENV,
  reserveSponsorBudget,
  SOURCE_BUDGET_XLM_ENV,
  sponsorBudgetEnforced,
} from '@/lib/api/sponsor-budget';

afterEach(() => {
  delete process.env[BUDGET_ENFORCEMENT_ENV];
  delete process.env[SOURCE_BUDGET_XLM_ENV];
  delete process.env[GLOBAL_BUDGET_XLM_ENV];
});

describe('reserveSponsorBudget', () => {
  it('charges both rows in a single round trip, with the global charge gated', async () => {
    let statement = '';
    let values: unknown[] = [];
    let calls = 0;
    const result = await reserveSponsorBudget({
      sourceAccount: `G${'A'.repeat(55)}`,
      feeStroops: 123,
      query: async (strings, ...bound) => {
        calls += 1;
        statement = strings.join('?');
        values = bound;
        return [{ budget_scope: 'source' }, { budget_scope: 'global' }];
      },
    });

    expect(result).toEqual({ ok: true });
    expect(calls).toBe(1);
    expect(statement).toMatch(/INSERT INTO sponsor_spend[\s\S]*ON CONFLICT[\s\S]*WHERE[\s\S]*RETURNING/i);
    expect(values).toContain(`G${'A'.repeat(55)}`);
    // The global charge is a CTE-gated second INSERT, not an independent row:
    // it may only land WHERE the source charge already did.
    expect(statement).toMatch(/WITH source_charge AS/i);
    expect(statement).toMatch(/WHERE EXISTS \(SELECT 1 FROM source_charge\)/i);
  });

  it('does not charge the global budget when the source ceiling is busted', async () => {
    process.env[SOURCE_BUDGET_XLM_ENV] = '0.00001'; // 100 stroops
    const charged: string[] = [];
    const result = await reserveSponsorBudget({
      sourceAccount: `G${'D'.repeat(55)}`,
      feeStroops: 500,
      query: async (_strings, ...values) => {
        // Mirrors the SQL: the source charge fails its ceiling, so the gated
        // global INSERT never fires and returns no row.
        const fee = Number(values[2]);
        const sourceCeiling = Number(values[3]);
        if (fee > sourceCeiling) return [];
        charged.push('source', 'global');
        return [{ budget_scope: 'source' as const }, { budget_scope: 'global' as const }];
      },
    });

    expect(result).toEqual({ ok: false, reason: 'source_budget_exceeded' });
    expect(charged).toEqual([]);
  });

  it('allows only reservations that fit when concurrent calls contend', async () => {
    process.env[SOURCE_BUDGET_XLM_ENV] = '0.00002'; // 200 stroops
    const spent = new Map<string, number>();
    let queue = Promise.resolve();
    const query = async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      let rows: Array<{ budget_scope: 'source' | 'global' }> = [];
      queue = queue.then(() => {
        // Bound order follows the gated statement: day, source, fee,
        // sourceCeiling, day, fee, globalCeiling.
        const day = String(values[0]);
        const source = String(values[1]);
        const fee = Number(values[2]);
        const sourceCeiling = Number(values[3]);
        const globalCeiling = Number(values[6]);
        const sourceKey = `${day}:source:${source}`;
        const nextSource = (spent.get(sourceKey) ?? 0) + fee;
        if (nextSource > sourceCeiling) return; // gate closed — global untouched
        spent.set(sourceKey, nextSource);
        rows.push({ budget_scope: 'source' });

        const globalKey = `${day}:global:`;
        const nextGlobal = (spent.get(globalKey) ?? 0) + fee;
        if (nextGlobal <= globalCeiling) {
          spent.set(globalKey, nextGlobal);
          rows.push({ budget_scope: 'global' });
        }
      });
      await queue;
      return rows;
    };

    const attempts = await Promise.all(
      Array.from({ length: 10 }, () =>
        reserveSponsorBudget({
          sourceAccount: `G${'B'.repeat(55)}`,
          feeStroops: 100,
          query,
        }),
      ),
    );

    expect(attempts.filter((result) => result.ok)).toHaveLength(2);
    expect(attempts.filter((result) => !result.ok)).toHaveLength(8);
  });

  it('keys a new ledger row after UTC midnight', async () => {
    const days: unknown[] = [];
    const query = async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      days.push(values[0]);
      return [{ budget_scope: 'source' as const }, { budget_scope: 'global' as const }];
    };

    await reserveSponsorBudget({
      sourceAccount: `G${'C'.repeat(55)}`,
      feeStroops: 100,
      now: new Date('2026-07-30T23:59:59.999Z'),
      query,
    });
    await reserveSponsorBudget({
      sourceAccount: `G${'C'.repeat(55)}`,
      feeStroops: 100,
      now: new Date('2026-07-31T00:00:00.000Z'),
      query,
    });

    expect(days).toEqual(['2026-07-30', '2026-07-31']);
  });

  it('distinguishes source, global, and unavailable ledger failures', async () => {
    const source = await reserveSponsorBudget({
      sourceAccount: `G${'D'.repeat(55)}`,
      feeStroops: 100,
      query: async () => [{ budget_scope: 'global' }],
    });
    const global = await reserveSponsorBudget({
      sourceAccount: `G${'D'.repeat(55)}`,
      feeStroops: 100,
      query: async () => [{ budget_scope: 'source' }],
    });
    const unavailable = await reserveSponsorBudget({
      sourceAccount: `G${'D'.repeat(55)}`,
      feeStroops: 100,
      query: async () => {
        throw new Error('offline');
      },
    });

    expect(source).toEqual({ ok: false, reason: 'source_budget_exceeded' });
    expect(global).toEqual({ ok: false, reason: 'global_budget_exceeded' });
    expect(unavailable).toMatchObject({ ok: false, reason: 'ledger_unavailable' });
  });
});

describe('sponsorBudgetEnforced', () => {
  it('defaults to shadow mode and enables only explicitly', () => {
    expect(sponsorBudgetEnforced()).toBe(false);
    process.env[BUDGET_ENFORCEMENT_ENV] = 'true';
    expect(sponsorBudgetEnforced()).toBe(true);
  });
});
