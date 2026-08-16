# Code Quality Audit & Improvement Plan

**Date:** 2026-08-16 · **Scope:** this repo (frontend, API layer, database, config/CI, and the five Soroban contracts) · **Method:** six parallel domain audits with every claim verified against the code at exact file:line. The companion audit for the `zentra-protocol` R&D repo lives in that repo's `CODE-QUALITY-AUDIT.md`.

This is a **code-quality** audit against best practices — distinct from `docs/SECURITY-REVIEW.md` (22 security findings). Where a quality finding touches a security control, the overlap is called out.

## Scorecard

| Area | Grade | Headline |
| --- | --- | --- |
| Backend / API (`src/lib/api`, `src/app/api`, `db/`) | **B+** | Disciplined trust boundary; weaknesses cluster in anchor verification, budget SQL, and zero route-handler tests |
| dApp surface (`src/components/app`, `src/lib/stellar`) | **B** | High craft on the happy path; the transaction *failure* paths carry the real risk, and tests avoid the risky code |
| Presentation & ZK playground (`landing/`, `playground/`, `src/lib/zk`) | **B+** | Excellent bundle/worker discipline; duplication has already produced diverging copy |
| Infrastructure / config / CI | **B−** | Healthy foundations; no lint toolchain exists at all, and CI has reproducibility gaps |
| Soroban contracts (`contracts/`) | **B** | Well-documented and honest; five crates copy-pasting what wants to be one workspace |

**Finding IDs:** BE (backend), DA (dApp), FX (presentation/ZK), IN (infra), CT (contracts). Severity: HIGH (bug / data risk), MED (maintainability, perf, missing tests around risky logic), LOW (polish). Effort: S/M/L.

**Suite counts at audit time:** 438 Vitest tests across 18 files, all passing; 38 Rust tests across 5 contracts, all passing; typecheck clean; one live clippy warning.

---

## 1. Backend / API — findings

| ID | Sev | Where | Problem → Fix | Effort |
| --- | --- | --- | --- | --- |
| BE-01 | HIGH | `src/lib/api/verify-anchor.ts:106`, `feedback/route.ts:116` | "Verified on-chain" badge earnable with any harvested tx hash: ownership check is skipped when `wallet` is omitted (validation makes it optional even with `onChain: true`), and no path checks the tx actually invoked the feedback contract. → Require `wallet` whenever `onChain` is claimed; verify the tx's operations target `actionLog.feedbackId`. | M |
| BE-02 | MED | `src/lib/api/sponsor-budget.ts:54-66` | Budget ceiling guards only the `DO UPDATE` branch; the first charge of each UTC day inserts with no ceiling comparison. → Gate the insert too (`INSERT … SELECT … WHERE fee <= ceiling` in both halves). | S |
| BE-03 | MED | `src/app/api/sponsor/route.ts:190-209` | `readBody` copy-pastes `readJsonBody` minus the content-type gate that validation.ts documents as a security control. → Give `readJsonBody` a `{ maxBytes }` option; delete the copy. | S |
| BE-04 | MED | feedback/onboard/sponsor/search routes | `enforceRateLimit`, `countRequest`, `storageUnavailable`, `isUniqueViolation`, `READ_CACHE_CONTROL` copy-pasted across four routes. → Export from `rate-limit.ts` + a `mapDbError` helper. | M |
| BE-05 | MED | `src/lib/db.ts:31` + 7 call sites | Untyped driver forces `as unknown as` at every query site. → One typed `query<T>` helper in db.ts so the cast exists in one audited place. | M |
| BE-06 | MED | `validation.test.ts` | `parseUserInput` and `isEmail` have zero tests — the parser guarding the only personal-data write. → Add the missing cases (lowercasing, wallet-required, note bounds, extras-dropping). | S |
| BE-07 | MED | all 7 routes | No route-handler tests at all, though `route()` returns a plainly invokable function. → Handler tests for moderation insert, anchor downgrade, 409 mapping, budget branching, CSV, health verdicts. | L |
| BE-08 | MED | `sponsor-budget.test.ts:43-107` | Budget tests assert against their own mock, which reimplements the intended semantics — exactly how BE-02 survived. → Test the real SQL against a real Postgres (Neon branch or pglite). | M |
| BE-09 | LOW | `src/lib/api/errors.ts:18` | Dead `method_not_allowed` code; unhandled methods bypass the JSON envelope; no `notFound()` factory. → Add the factory; delete or wire the 405. | S |
| BE-10 | LOW | `src/lib/api/errors.ts:118-123` | Structural `isApiError` duck-typing can reflect third-party error messages to clients. → `Symbol.for()` brand check. | S |
| BE-11 | LOW | `src/lib/api/logger.ts:30,126-143` | PII regex misses `fullName`/`user_name`; nested `Error`s serialize to `{}`. → Widen the regex; normalise Errors recursively. | S |
| BE-12 | LOW | `src/app/api/sponsor/route.ts:119-134` | `sponsor.refused` logged for requests then granted in shadow mode; budget refusals double-logged; 503 on ledger outage even in shadow mode. → One event per outcome; decide the shadow-mode outage behavior deliberately. | S |
| BE-13 | LOW | `db/schema.sql`, migration 003 | Stale header comments, misplaced `sponsor_spend` table, indexes that no longer match live query patterns (`NOT hidden` filter vs partial index; two indexes serve no query). → Refresh comments; drop/replace drifted indexes; bring 003 up to the 001/002 conventions. | S |
| BE-14 | LOW | `src/lib/db.ts:18,40` | Client memoised forever ignores `DATABASE_URL` rotation — contradicting sponsor.ts's own per-call rotation philosophy. → Cache keyed on the URL string. | S |

