import { query as dbQuery } from '@/lib/db';

export const SOURCE_BUDGET_XLM_ENV = 'SPONSOR_DAILY_SOURCE_BUDGET_XLM';
export const GLOBAL_BUDGET_XLM_ENV = 'SPONSOR_DAILY_GLOBAL_BUDGET_XLM';
export const BUDGET_ENFORCEMENT_ENV = 'SPONSOR_BUDGET_ENFORCE';

const STROOPS_PER_XLM = 10_000_000;
const DEFAULT_SOURCE_XLM = 10;
const DEFAULT_GLOBAL_XLM = 100;

export type BudgetResult =
  | { ok: true }
  | { ok: false; reason: 'source_budget_exceeded' | 'global_budget_exceeded' }
  | { ok: false; reason: 'ledger_unavailable'; error: unknown };

type Query = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Array<{ budget_scope: 'source' | 'global' }>>;

export interface BudgetReservation {
  sourceAccount: string;
  feeStroops: number;
  now?: Date;
  query?: Query;
}

/**
 * Applies the charge to the source and global UTC-day rows.
 *
 * Both conditional upserts are in one Neon HTTP statement, and the invariant —
 * `spent + fee <= ceiling` — is enforced on BOTH branches of each upsert. The
 * day's first charge for a (day, scope, account) takes the INSERT branch, so it
 * is written as `INSERT ... SELECT ... WHERE fee <= ceiling` rather than a bare
 * `VALUES`: the `ON CONFLICT ... WHERE` clause guards only the UPDATE branch,
 * and an unguarded VALUES would let the first request of the day land any fee,
 * however far past the ceiling. Every later charge takes the UPDATE branch,
 * whose WHERE evaluates against the latest committed value under PostgreSQL's
 * per-row serialization of ON CONFLICT updates — so there is no check/increment
 * race between serverless instances on either branch.
 *
 * The global charge is gated on the source charge having landed. Written as two
 * independent rows of one INSERT, a request that busts its own source ceiling
 * would still increment the global counter — letting an account that has already
 * exhausted its own budget drain the global ceiling with requests that are each
 * refused, denying every other user. Gating confines the residual over-count to
 * the caller's own source budget, which is self-limiting.
 */
export async function reserveSponsorBudget(input: BudgetReservation): Promise<BudgetResult> {
  const sourceCeiling = ceiling(SOURCE_BUDGET_XLM_ENV, DEFAULT_SOURCE_XLM);
  const globalCeiling = ceiling(GLOBAL_BUDGET_XLM_ENV, DEFAULT_GLOBAL_XLM);
  const day = utcDay(input.now ?? new Date());

  try {
    // The shared typed helper, instantiated to the one column this statement
    // returns; `input.query` is the seam the unit tests inject through.
    const query: Query = input.query ?? dbQuery<{ budget_scope: 'source' | 'global' }>;
    // The fee and ceiling parameters are cast to bigint where they meet in a
    // comparison: two untyped parameters give Postgres nothing to resolve the
    // operator against, and `unknown <= unknown` is an error, not a guess.
    const rows = await query`
      WITH source_charge AS (
        INSERT INTO sponsor_spend (spend_day, budget_scope, source_account, spent_stroops)
        SELECT ${day}::date, 'source', ${input.sourceAccount}, ${input.feeStroops}::bigint
        WHERE ${input.feeStroops}::bigint <= ${sourceCeiling}::bigint
        ON CONFLICT (spend_day, budget_scope, source_account)
        DO UPDATE SET spent_stroops = sponsor_spend.spent_stroops + EXCLUDED.spent_stroops
        WHERE sponsor_spend.spent_stroops + EXCLUDED.spent_stroops <= ${sourceCeiling}
        RETURNING budget_scope
      ),
      global_charge AS (
        INSERT INTO sponsor_spend (spend_day, budget_scope, source_account, spent_stroops)
        SELECT ${day}::date, 'global', '', ${input.feeStroops}::bigint
        WHERE EXISTS (SELECT 1 FROM source_charge)
          AND ${input.feeStroops}::bigint <= ${globalCeiling}::bigint
        ON CONFLICT (spend_day, budget_scope, source_account)
        DO UPDATE SET spent_stroops = sponsor_spend.spent_stroops + EXCLUDED.spent_stroops
        WHERE sponsor_spend.spent_stroops + EXCLUDED.spent_stroops <= ${globalCeiling}
        RETURNING budget_scope
      )
      SELECT budget_scope FROM global_charge
      UNION ALL
      SELECT budget_scope FROM source_charge
    `;

    const scopes = new Set(rows.map((row) => row.budget_scope));
    if (!scopes.has('source')) return { ok: false, reason: 'source_budget_exceeded' };
    if (!scopes.has('global')) return { ok: false, reason: 'global_budget_exceeded' };
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: 'ledger_unavailable', error };
  }
}

export function sponsorBudgetEnforced(): boolean {
  return process.env[BUDGET_ENFORCEMENT_ENV]?.trim().toLowerCase() === 'true';
}

function ceiling(name: string, fallbackXlm: number): number {
  const value = Number(process.env[name]);
  const xlm = Number.isFinite(value) && value > 0 ? value : fallbackXlm;
  return Math.floor(xlm * STROOPS_PER_XLM);
}

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}
