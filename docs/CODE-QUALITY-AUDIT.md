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

---

## 2. dApp surface — findings

| ID | Sev | Where | Problem → Fix | Effort |
| --- | --- | --- | --- | --- |
| DA-01 | HIGH | `feedback-form.tsx:43-71` | On-chain-then-API dual write: if the API POST fails, the tx hash is discarded and a retry re-signs a **second** on-chain transaction for one intent. → Keep the settled hash in state so retry resumes at the API step; surface the hash on partial failure. | M |
| DA-02 | HIGH | `src/lib/stellar/payment.ts:40-44`, `send-form.tsx:30` | No Horizon-timeout handling (a 504-ed tx can still settle → UI says "failed") and no in-flight guard on submit → natural retry = double payment. → On timeout-shaped errors poll for the client-side `tx.hash()` before declaring failure; add `if (inFlight) return`. | M |
| DA-03 | HIGH | `action-feed.tsx:69-85` | Poll cursor stalls permanently behind a swallow-all catch once `startLedger` falls out of RPC retention (sleeping laptop); overlapping ticks can move the cursor backwards. → Count consecutive failures and reseed after N; skip a tick while one is in flight. | M |
| DA-04 | MED | `src/lib/stellar/action-log.ts:109-127` | `submitInvoke` throws generic strings, drops diagnostics/hash on failure, and lets `TRY_AGAIN_LATER`/`DUPLICATE` burn the 30s poll. → Map each send status; include hash in thrown errors; decode `resultXdr`. | M |
| DA-05 | MED | `action-log.ts:139-144` | `pollEvents` has no topic filter and blind-casts every event — a second event type would inject garbage entries. → Add `topics` filter; validate shape before `toEntry`. | S |
| DA-06 | MED | `action-log.ts:81`, `feedback.ts:62`, `proofs.ts:91` | Chain data blind-cast while API data is runtime-validated — inconsistent with the codebase's own standard. → One `isRawEntry`-style guard per decoded shape. | S |
| DA-07 | MED | `tx-status.tsx:47-49,105` | "Payment settled" hardcoded into the shared status component — wrong copy (visible + aria-live) for contract invokes. → Labels prop with payment defaults. | S |
| DA-08 | MED | `wallet-provider.tsx:79-108` | Persisted address trusted without re-verifying the kit's active account (stale-account signing); `connect` swallows all failures so ConnectButton reverse-engineers outcomes via a ref. → Verify address after `setWallet` on mount; typed connect outcome. | M |
| DA-09 | MED | send/record/feedback forms | The build→sign→submit pipeline is copy-pasted three times and has already diverged (feedback form skips TxStatus and its announcements). → Extract `useTxPipeline(build, submit)` owning TxState, in-flight guard, error mapping. | M |
| DA-10 | MED | `join-form.tsx:674` vs `feedback-form.tsx:99`; `join-progress.tsx` vs `metrics-stats.tsx` | Star-rating block duplicated character-for-character; `isOnboardCount` duplicated; the 50-signup goal and 6s poll cadence each defined twice. → Extract `<StarRating>`; move guard + constants to shared modules. | S |
| DA-11 | MED | `balance-card.tsx:105-118`, board/metrics reads | Mainnet guards exist but nothing uses them: Friendbot UI renders unconditionally; nothing checks `contractsConfigured` before contract reads. → Gate Friendbot on `hasFriendbot`, reads on `contractsConfigured`. | S |
| DA-12 | MED | balance-card, action-feed, feedback-summary | Async status changes (funding outcome, errors, stale banners) not announced to screen readers, unlike the tx-status pattern. → Reuse the pre-mounted live-region pattern. | S |
| DA-13 | MED | `join-form.tsx` (769 lines) | Monolith whose best-testable logic (wallet-input validation) is module-private. → Move validators to `src/lib/stellar/wallet-input.ts`; split `InviteLink` + success panel. | M |
| DA-14 | MED | `get-started.tsx:224-264` + `balance-card.tsx:32-59` | Two components independently poll the same balance; no poll pauses when the tab is hidden. → `useXlmBalance(address)` hook; visibility check in intervals. | M |
| DA-15 | MED | `src/lib/stellar/` | Only the two trivial pure modules are tested; every module that talks to the chain has zero tests. → See test-debt phase. | L |
| DA-16 | LOW | `action-log.ts:68`, `types.ts:27` | Dead exports: `scoreOf`, `PaymentRequest`. → Delete. | S |
| DA-17 | LOW | 10 files | `focusRing` constant declared identically in ten components. → One export. | S |
| DA-18 | LOW | wallet-provider, record-form, tx-status | Async `disconnect` rejection unhandled; `/200` hardcoded next to a `MAX` constant; hardcoded `#22c55e` instead of the theme token. → Small fixes. | S |
| DA-19 | LOW | `payment.ts:24` et al. | Static `BASE_FEE` everywhere — fine on testnet, strands txs under mainnet surge pricing. → `fetchBaseFee()` or config multiplier before cutover. | S |


