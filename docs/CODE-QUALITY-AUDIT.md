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

---

## 3. Presentation & ZK playground — findings

| ID | Sev | Where | Problem → Fix | Effort |
| --- | --- | --- | --- | --- |
| FX-01 | MED | `playground/layout.tsx:6` → `kit.ts` | Playground eagerly bundles the entire Stellar Wallets Kit (barrel re-exports its modal stack) before a visitor generates any proof. → Make `getKit` async-import, or lazy-load `WalletProvider`. | M |
| FX-02 | MED | `src/lib/zk/prover.ts:195-209`, `proof-lab.tsx:163` | No cancel, no timeout, no `messageerror` handler — a hung worker locks the lab at "Proving…" until navigation. → Watchdog timeout, `messageerror`, swap disabled button for Cancel. | S/M |
| FX-03 | MED | `proof-engine.tsx:76-112`, `scenario-panels.tsx:43` | Scenario clicks silently dropped while autoplay is busy (most of the visible time); buttons never disabled. → Queue/preempt the requested scenario; mark buttons busy. | M |
| FX-04 | MED | `src/lib/scenarios.ts` vs landing copies | The self-declared "single source" is only used by the playground; landing carries two more copies which have diverged (400 vs 500; visible `STATEMISMATCH` typo). → Derive landing configs from `SCENARIOS`; fix the typo. | M |
| FX-05 | MED | `playground/page.tsx:12-28` | Copy claims "verify it on-chain against the live Soroban verifier" — the flow anchors a commitment; the pitch deck explicitly disclaims re-verification. Trust-product copy bug. → Reword to "anchor its commitment on-chain". | S |
| FX-06 | MED | `proof-engine.tsx:32-71` | Imperative querySelector/style animation duplicates the declarative sibling in scenario-panels; untyped `data-z-*` contract fails silently at runtime. → Converge on one state-driven rail component. | L |
| FX-07 | MED | `education.ts`, `public-inputs-table.tsx`, `system-bar.tsx:10` | Three hand-maintained copies of the 14-public-signal contract (numbered differently; count hardcoded as `'14'`). → Render the docs table from `SIGNALS`; derive the count. | S/M |
| FX-08 | MED | `for-developers.tsx:29-48` vs `:133-150` | The SDK code sample is maintained twice: clipboard string + hand-tokenized JSX transcription. → Render from the single string. | M |
| FX-09 | MED | `proof-engine.tsx:180`, `scenario-panels.tsx:162` | Animated blocked/released outcomes invisible to screen readers (no `aria-live`/`role="status"`), though scenario-player already shows the right pattern. → Add the roles. | S |
| FX-10 | MED | multiple landing files | Primitives not absorbing duplication: 4-corner bracket cluster ×4, numbered-eyebrow header ×4, five ad-hoc truncation helpers. → `HudPanel corners` variant, `Eyebrow index` prop, one `shorten()` export. | M |
| FX-11 | MED | `package.json`, `public/zk/zk-worker.js:5` | `snarkjs` + `@types/snarkjs` deps are dead weight; the vendored 688KB UMD can silently drift from the documented 0.7.6. → Remove deps, or add a postinstall copy from node_modules so the manifest is the source of truth. | S |
| FX-12 | LOW | `prover.ts:79-122`, `proof-lab.tsx:113` | Download progress can exceed 100% and regress (headers arrive late; decompressed bytes vs content-length). → Clamp; report percent only once all sizes known. | S |
| FX-13 | LOW | `pitch-deck.tsx:165` | `scrollIntoView({ smooth })` ignores reduced-motion; slide changes not announced. → `matchMedia` check; `aria-live` counter. | S |
| FX-14 | LOW | `shared.ts`, `zentra-mark.tsx`, `logo.tsx`, `the-gap.tsx` | Dead exports (`appName`, `docsImageRoute`, `docsContentRoute`), dead props (`mono`/`onlight`, `showProtocolTag`), ignored `desc` field. → Delete or wire up. | S |
| FX-15 | LOW | `verifier-monolith.tsx:29`, `proof-engine.tsx:52` | Untracked timers fire after unmount in the monolith; the engine's timer array grows unbounded for the page's life. → Track-and-clear; prune fired ids. | S |

---

## 4. Infrastructure / config / CI — findings

| ID | Sev | Where | Problem → Fix | Effort |
| --- | --- | --- | --- | --- |
| IN-01 | HIGH | `.github/workflows/ci.yml:48` | `bun install` without `--frozen-lockfile` — a PR with a drifted lockfile merges green while testing different dependency versions. → Add the flag. | S |
| IN-02 | MED | ci.yml:44, package.json | Bun unpinned everywhere (`latest` in CI vs 1.3.13 local; no `packageManager`/`engines`). → Pin both. | S |
| IN-03 | MED | repo root | **No linter or formatter exists at all** — and Next 16 dropped `next lint`, so react-hooks rules, unused imports, and a11y rules are checked by nothing. → Add Biome (or ESLint flat + eslint-config-next) + script + CI step. | M |
| IN-04 | MED | ci.yml:29-38 | Contracts job runs tests only — no `cargo fmt --check`, no `cargo clippy -- -D warnings` (a live warning exists today, CT-12). → Add both steps. | S |
| IN-05 | MED | ci.yml:3-5 | `on: push` (all branches) + `pull_request` double-runs every PR commit; no concurrency cancellation. → Restrict push to main; add `concurrency` with cancel-in-progress. | S |
| IN-06 | MED | ci.yml:19-26 | Cargo cache omits `zentra-multisig/target` and keys on `Cargo.toml` instead of `Cargo.lock`. → Fix paths + key, or `Swatinem/rust-cache`. | S |
| IN-07 | MED | package.json | No aggregate `check` script reproducing the CI gate locally. → `"check": "bun run types:check && bun run test"` (+ lint once IN-03 lands); CI calls it. | S |
| IN-08 | MED | tsconfig.json:7 | `strict` but no `noUncheckedIndexedAccess`/`noUnusedLocals` — cheap insurance given `Record` lookups in config. → Enable, narrow the few call sites. | M |
| IN-09 | MED | .gitignore:29 | Plain `.env` not ignored, and the env contract includes `SPONSOR_SECRET` (a funded key). → Ignore `.env`/`.env.*`, keep `!.env.example`. | S |
| IN-10 | MED | package.json:23,27,36 | Unused direct deps: `lucide-react` (transitive via fumadocs-ui), `snarkjs` + types (worker loads the vendored UMD). → Remove or document as provenance pin (see FX-11). | S |
| IN-11 | MED | `.github/` | No Dependabot/Renovate, no `bun audit`/`cargo audit` — for an app with a server-side fee-sponsoring key path. → Dependabot (npm+cargo+actions) + audit step. | S |
| IN-12 | MED | `contracts/deploy.sh` | Deploys 2 of the 4 contracts `src/config/contract.ts` requires (5 counting multisig); accepts `NETWORK=mainnet` with no confirmation. → Extend to all contracts; prompt when NETWORK != testnet. (= CT-10) | M |
| IN-13 | LOW | ci.yml | No wasm-size or bundle-size budget despite the "size-optimized wasm" claim. → Budget check step. | S |
| IN-14 | LOW | git history | 3.26MB wasm + 2.32MB zkey tracked (defensible but history-fattening); two screenshots tracked twice byte-for-byte (`public/img/` + `docs/screenshots/`). → Consider LFS; dedupe images. | S |
| IN-15 | LOW | README.md:245 | Stale hardcoded test counts (says 324/15; actual 438/18). → Update or stop hardcoding. | S |
| IN-16 | LOW | `src/config/protocol.ts:22` | Hand-typed passphrase contradicts network.ts's own "passphrases come from the SDK" rule. → Use `Networks.TESTNET`. | S |
| IN-17 | LOW | vitest.config.ts | No coverage provider/thresholds (gitignore already anticipates `/coverage`). → `@vitest/coverage-v8` + modest thresholds. | S |

---

## 5. Soroban contracts — findings

| ID | Sev | Where | Problem → Fix | Effort |
| --- | --- | --- | --- | --- |
| CT-01 | MED | `zentra-action-log/src/lib.rs:158-164` (+feedback:131, +proof-registry:97) | `get_recent` counts skipped entries toward `limit` — copy-pasted into three contracts; the `None` branch is simultaneously dead in practice and wrong if it ever fires. → Fix once (`taken += 1` inside the `Some` arm or drop the dead branch with a comment), propagate to all three. | S |
| CT-02 | MED | all five crates | TTL constants, `get_recent`, and the Count/Entry pattern copy-pasted with no shared module or written convention (reputation even renames the constants). → Tiny shared non-contract crate, or `contracts/CONVENTIONS.md` stating canonical constants/topics/pagination. | M |
| CT-03 | MED | `contracts/` (no manifest) | No cargo workspace: five duplicated release profiles, five lockfiles **already drifted** (multisig pins soroban-sdk 26.1.1, the rest 26.1.0), five CI steps. → `[workspace]` with shared profile + `workspace.dependencies`, one lockfile. | S |
| CT-04 | MED | `zentra-action-log/src/lib.rs:54-57` | Hand-maintained `Reputation` client trait declares `-> u32` but the real contract returns `Result<u32, Error>` — works only because the caller uses `try_bump`; nothing prevents drift. → Declare the true signature or `contractimport!` the wasm. | S |
| CT-05 | MED | feedback:36, proof-registry:34 | Event payloads inconsistent (`Submitted` omits comment+ledger, `Anchored` omits signals+ledger, forcing indexer follow-up reads) and topic style drifts (noun `"feedback"` vs past-tense everywhere else). → Complete payloads; settle topic naming **before mainnet** (rename is a breaking change). | S |
| CT-06 | MED | feedback, proof-registry | Only action-log exposes `get_entry`; entries older than the newest 20 are stored (and rent-paid) forever but unreachable via API in two contracts; `summary` returns a bare tuple. → Add `get_entry` parity (3 lines each); named struct for summary. | S |
| CT-07 | MED | `zentra-proof-registry/src/lib.rs:48` | The only contract with no error enum and no input validation (`signals: 0` or `u32::MAX` accepted silently). → `Result` return + a `signals` bound, matching the other four's convention. | S |
| CT-08 | MED | action-log:120, feedback:90, proof-registry:66, reputation:81 | Counter arithmetic inconsistent: multisig uses `checked_add` + typed error (the review's own "better pattern"); the other four rely on the profile's overflow trap. → Apply uniformly or comment why the trap is accepted. | S |
| CT-09 | MED | `zentra-reputation/src/lib.rs:7,83` | TTL drift: scores bumped 30 days while the entries referencing them live 90 — an inactive author's score archives two months early. → Align on `ENTRY_BUMP` or document the shorter life. | S |
| CT-10 | MED | `contracts/deploy.sh` | Covers two of five contracts (see IN-12). → Scripted, reviewable path for every deployed contract. | M |
| CT-11 | MED | ci.yml:30-38 | No clippy/fmt gate (live warning proves it); cache omits multisig target (see IN-04/IN-06). → Gate after CT-03's workspace lands. | S |
| CT-12 | LOW | `zentra-feedback/src/lib.rs:63` | Clippy `manual_range_contains` (the one live warning); the `if limit > MAX_RECENT` clamps read better as `limit.min(MAX_RECENT)`. → Idiomatic forms. | S |
| CT-13 | MED | four of five test suites | Event tests assert only `events().len() == 1` — a renamed topic or dropped payload field passes CI. Multisig asserts full topics/payloads. → Copy multisig's pattern into the other four. | S |
| CT-14 | LOW | action-log:79, feedback:67 | Length caps are UTF-8 **byte** budgets documented as if characters — the frontend must enforce the same unit. → Say "bytes"; rename to `MAX_MESSAGE_BYTES`. | S |
| CT-15 | LOW | action-log:71,99; reputation:57 | Undocumented `unwrap()`s on constructor-guaranteed keys; multisig shows the documented helper pattern. → Adopt it so every non-test unwrap states its invariant. | S |
| CT-16 | LOW | Cargo.tomls, doc comments | No toolchain/MSRV pin under a floating `stable`; `get_recent` docstrings hardcode "capped at 20". → `rust-toolchain.toml`; reference the constant. | S |

---

## Improvement plan

Phases are ordered by leverage: fix what's broken, then make regressions impossible, then pay down structure and tests. Each item cites its finding ID; an item is done when the fix lands **with a test where one is possible**.

### Phase 0 — Critical correctness (do first)

- [ ] BE-01 Anchor verification: require `wallet` when `onChain: true`; verify the tx invoked the feedback contract
- [ ] DA-01 Feedback dual-write: retry resumes at the API step, never re-signs; surface the partial-failure hash
- [ ] DA-02 Payment submit: timeout → poll for the client-side hash before declaring failure; in-flight guard on the form
- [ ] DA-03 Action feed: failure counter → reseed; skip overlapping ticks
- [ ] IN-01 CI: `bun install --frozen-lockfile`

### Phase 1 — Guardrails (toolchain & CI; makes every later phase safer)

- [ ] IN-03 Add a linter (Biome or ESLint flat config) + `lint` script + CI step
- [ ] IN-04/CT-11 `cargo fmt --check` + `cargo clippy -- -D warnings` in CI (fix CT-12's live warning first)
- [ ] CT-03 Cargo workspace: one lockfile (resolves the 26.1.0/26.1.1 drift), one profile, one test/clippy invocation
- [ ] IN-02 Pin Bun in CI + `packageManager` field
- [ ] IN-05 CI concurrency cancellation; restrict push triggers to main
- [ ] IN-06 Fix cargo cache (multisig target, key on Cargo.lock) or adopt rust-cache
- [ ] IN-07 Aggregate `check` script; CI calls it
- [ ] IN-09 Gitignore plain `.env`
- [ ] IN-11 Dependabot (npm + cargo + actions) + audit step
- [ ] IN-08 `noUncheckedIndexedAccess` + unused-code flags
- [ ] IN-17 Vitest coverage provider + thresholds

### Phase 2 — Correctness & robustness (behind the guardrails)

- [ ] BE-02 Gate the budget INSERT branch on the ceiling (both scopes)
- [ ] BE-03 `readJsonBody({ maxBytes })`; delete the sponsor route's copy
- [ ] CT-01 Fix `get_recent` counting in all three contracts
- [ ] CT-04 True `Result` signature on the Reputation client trait
- [ ] DA-04 `submitInvoke`: map send statuses, carry the hash in errors, decode failure results
- [ ] DA-05 Topic filter + shape validation in `pollEvents`
- [ ] DA-06 Runtime guards for all decoded chain data (match the API-boundary standard)
- [ ] DA-08 Re-verify persisted wallet address on mount; typed `connect` outcome
- [ ] DA-11 Wire `hasFriendbot` and `contractsConfigured` into the UI they were built for
- [ ] FX-02 Prover worker: watchdog timeout, `messageerror`, Cancel button
- [ ] FX-03 Queue/preempt scenario clicks during autoplay
- [ ] BE-11 Logger: widen PII regex, normalise nested Errors
- [ ] BE-14 DB client cache keyed on URL
- [ ] BE-12 One sponsor log event per outcome; deliberate shadow-mode outage decision
- [ ] BE-10 Brand `isApiError` with `Symbol.for`
- [ ] DA-19 Dynamic base fee (required before mainnet cutover)

### Phase 3 — Deduplication & structure

Backend: BE-04 shared `enforceRateLimit`/`countRequest`/`mapDbError` · BE-05 typed `query<T>` helper.
dApp: DA-09 `useTxPipeline` hook · DA-10 `<StarRating>` + shared guards/constants · DA-13 split join-form, extract wallet-input validators · DA-14 `useXlmBalance` + visibility-paused polling · DA-07 TxStatus label props · DA-17/FX-10 one `shorten()`, one `focusRing`, HudPanel/Eyebrow variants.
Presentation: FX-04 scenarios single-source (+ typo) · FX-07 signals single-source · FX-08 code sample single-source · FX-06 converge on one animation idiom (optional, L).
Contracts (pre-mainnet window for breaking changes): CT-02 conventions doc/shared crate · CT-05 complete event payloads + settle topic naming · CT-06 `get_entry` parity · CT-07 proof-registry error enum · CT-08 uniform `checked_add` · CT-09 TTL alignment · CT-15 documented unwraps.

### Phase 4 — Test debt (the single biggest theme: coverage is inverted relative to risk)

Priority order:
1. BE-07 route-handler tests (moderation insert, anchor downgrade+`txHash: null`, 409 mapping, budget branching, CSV escaping, health verdicts, admin gate ordering)
2. DA-15 stellar lib tests (`submitInvoke` status matrix, `getXlmBalance` 404→null, `commitProof` digest, friendbot `op_already_exists`, payment XDR shape)
3. BE-08 budget SQL against a real Postgres (first-insert-over-ceiling, contention) — replaces the tautological mocks
4. BE-06 `parseUserInput`/`isEmail`
5. Component tests, top five: wallet-provider, send-form, connect-button, action-feed, feedback-form (the DA-01 matrix)
6. CT-13 event payload assertions in four suites + boundary tests (`MessageTooLong`, `CommentTooLong`, `LoggerNotSet`, `MAX_RECENT` clamp, rating bounds, multisig `CounterOverflow`) + one integration test against the real reputation crate
7. FX prover-pipeline tests (`isWorkerPayload`, memo failure-reset, progress clamp) + consistency tests that would have caught FX-04/FX-07 (assert `SIGNALS.length === 14`, landing copy derives from `SCENARIOS`)
8. IN config tests (`contractsConfigured` false for empty set, stellar URL builders, site fallbacks) + an `.env.example` drift test

### Phase 5 — Polish & copy accuracy

- [ ] FX-05 Fix the on-chain-verification claim (trust-product copy bug) · FX-09/DA-12/FX-13 a11y announcements · DA-16/FX-14 dead code · FX-11/IN-10 snarkjs dep decision · IN-12/CT-10 deploy.sh all contracts + mainnet prompt · IN-13 size budgets · IN-14 image dedupe · IN-15 README counts · IN-16 SDK passphrase constant · BE-09 `notFound()` + 405 envelope · BE-13 schema doc/index cleanup · CT-12 clippy idioms · CT-14 byte-unit docs · CT-16 toolchain pin · DA-18 small fixes · FX-12 progress clamp · FX-15 timer hygiene

## What NOT to change

The audits unanimously flagged these as better-than-typical practices to preserve through any refactor:

- The `route()` wrapper contract and its property tests; field-by-field trust-boundary rebuilds; unique-index-mapped-to-409 race handling; dual-layer validation (API rule ↔ named CHECK constraint); fail-closed secrets (missing token/secret ⇒ 503); rate-limit key derivation; cache-control discipline; CSV formula-injection defense.
- Derived-state-on-render, cancellation flags on every data effect, pre-mounted live regions, the connect-button focus trap, honest "lower bound" metric labeling, 409-as-success duplicate handling.
- snarkjs kept out of the app bundle (classic worker + vendored UMD), fresh worker per proof run, runtime-guarded worker boundary, correct server/client landing split, pervasive reduced-motion handling, externalized pitch data with honest caveats.
- `.env.example` as a documented contract with zero drift (verified); single-source network config failing safe to testnet; least-privilege CI permissions; tracked lockfiles.
- Contracts: uniform release profiles, negative-auth tests in every suite, the `try_bump` degradation pattern with its regression test and in-code pointer to the finding it fixes, typed `#[contractevent]` structs, `MAX_RECENT` read bounds, multisig as the house style template.
- Comments that state threat models and why-not-alternatives — several findings were findable *only because* the code says what it intends. Keep writing them.






