# Zentra contract conventions

House rules for the five Soroban contracts in this workspace
(`zentra-action-log`, `zentra-feedback`, `zentra-multisig`,
`zentra-proof-registry`, `zentra-reputation`). New code follows these; drift is
a review finding.

## TTL constants

Canonical names, defined per crate (values in ledgers, ~5s each):

| Constant             | Value             | Meaning                                        |
| -------------------- | ----------------- | ---------------------------------------------- |
| `DAY_LEDGERS`        | `17_280`          | ~1 day of ledgers                              |
| `INSTANCE_BUMP`      | `30 * DAY_LEDGERS`| instance storage lives 30 days per touch       |
| `INSTANCE_THRESHOLD` | `INSTANCE_BUMP - DAY_LEDGERS` | re-extend when within a day of the bump target |
| `ENTRY_BUMP`         | `90 * DAY_LEDGERS`| persistent entries live 90 days per touch      |
| `ENTRY_THRESHOLD`    | `ENTRY_BUMP - DAY_LEDGERS` | same rule for entries                 |

Rules:

- Every state-writing function extends the instance TTL
  (`INSTANCE_THRESHOLD` / `INSTANCE_BUMP`).
- Every persistent write extends that key's TTL
  (`ENTRY_THRESHOLD` / `ENTRY_BUMP`).
- Persistent data that other persistent data references must live at least as
  long as its referrers. That is why reputation `Score` keys use the 90-day
  `ENTRY_BUMP`: Action Log entries embed the score and live 90 days.
- Do not invent new durations without a written reason next to the constant.

## Storage keys

- One `#[contracttype] pub enum DataKey` per contract; no raw symbols/strings.
- Instance storage: configuration and counters (`Admin`, `Logger`, `Signers`,
  `Threshold`, `Reputation`, `Count`, `RatingSum`).
- Persistent storage: unbounded per-item data, keyed by counter
  (`Entry(u64)`, `Proposal(u64)`) or by address (`Score(Address)`).
- Never store unbounded collections under a single key.

## Events

- `#[contractevent]` typed structs only — no hand-rolled `publish` calls.
- Topic style: one **past-tense** symbol naming the fact that happened —
  `recorded`, `submitted`, `anchored`, `bumped`, `logger_set`, `proposed`,
  `approved`, `executed`.
- Payload completeness rule: the event data carries everything a consumer
  needs to render the fact **without a follow-up read** — for entry-creating
  calls that means the full entry (index, author/prover, payload fields, and
  the `ledger` sequence).
- Admin actions that change wiring (e.g. `set_logger`) must emit an event;
  silent repoints are forbidden (see docs/SECURITY-REVIEW.md ZEN-01).
- Tests assert full topics **and** data via `event.topics(&env)` /
  `event.data(&env)` against `env.events().all()` — not just `len() == 1`.

## Pagination / read API

Every list-keeping contract exposes the same trio:

- `get_count() -> u64` — total items ever written (also the next index).
- `get_entry(index: u64) -> Option<Entry>` — point read; `None` for a missing
  index, never a trap.
- `get_recent(limit: u32) -> Vec<Entry>` — newest first, `limit` clamped to
  `MAX_RECENT` (canonically `20`). Doc comments reference `MAX_RECENT` rather
  than hardcoding the number.

## Errors

- One `#[contracterror] pub enum Error` per contract; codes start at `1` and
  are contiguous per contract.
- Codes are append-only: never renumber or reuse a code once deployed.
- Every counter-bearing contract has a typed overflow variant
  (`CounterOverflow`; reputation uses `ScoreOverflow` for its score).
- Cross-contract error mirrors (Action Log's `ReputationError`) are pinned to
  the real crate's codes by a test, so drift fails the build.

## Checked arithmetic

- All counter/accumulator increments use `checked_add` and return the typed
  overflow error — never bare `+` on stored values. A wrapped counter would
  let a new entry overwrite an old one; a wrapped sum silently falsifies
  aggregates.
- (The release profile also sets `overflow-checks = true`, but the typed error
  is the contract's interface, not a trap.)

## Documented unwraps

- A bare `.unwrap()` on storage is only allowed for keys the constructor
  always writes, and only inside a small named helper carrying the standard
  justification comment (multisig's `signers_of` / `threshold_of`, action
  log's `reputation_of`, reputation's `admin_of`): *"Panics only if the
  contract was never constructed, which the host makes impossible for a
  deployed contract."*
- Anything else uses `Option`/`Result` with a typed error.

## Length caps are byte budgets

- Text caps are **bytes (UTF-8)**, not characters — `String::len` counts
  bytes, and multi-byte characters consume more of the budget.
- Constants are named for the unit: `MAX_MESSAGE_BYTES` (200, action log) and
  `MAX_COMMENT_BYTES` (280, feedback); doc comments say "bytes (UTF-8)".
- The frontend must enforce the **same unit** (e.g. `TextEncoder` byte length,
  not `.length`), or users with multi-byte input get contract rejections the
  UI said were fine.

## Redeploy checklist (this pass)

The testnet contracts are deployed from an older source revision and the
frontend reads them live. The changes below alter the on-chain interface, so
at the **next deploy** the frontend must move in lockstep. Additive changes
(new functions, new event fields, new error codes) are listed for awareness
but need no frontend change to keep working.

1. **feedback `Submitted` event** — topic renamed `feedback` → `submitted`;
   data now carries `comment` and `ledger` alongside `index`/`author`/`rating`.
   Frontend touchpoint: **none today** — `src/lib/stellar/action-log.ts`
   `pollEvents` filters by contract id only and no code subscribes to feedback
   events. Any future topic filter or off-chain indexer must use `submitted`.
2. **feedback `summary()`** — returns a named `Summary { count, rating_sum }`
   struct instead of the bare `(u64, u64)` tuple. Frontend touchpoint:
   `src/lib/stellar/feedback.ts` has **no `summary()` caller yet**; when the
   feedback-summary flow lands there it must decode the struct by field name
   (`count`, `rating_sum`), not by tuple position.
3. **proof-registry `anchor()`** — now returns `Result<u64, Error>` and
   rejects `signals == 0` (`NoSignals` #1) and `signals > 64`
   (`TooManySignals` #2; the current circuit exposes 14 public signals — 64
   leaves headroom). The success value is still the plain `u64` index on the
   wire. Frontend touchpoint: `src/lib/stellar/proofs.ts` `buildAnchorXdr`
   simulation now surfaces these as contract errors #1/#2 — error handling
   copy may want to translate them; the success path decode is unchanged.
4. **proof-registry `Anchored` event** — data gains `signals` and `ledger`
   (additive; decode by key keeps working).
5. **New read functions** — `get_entry(index)` on feedback and proof-registry
   (additive).
6. **New error codes** — action log `CounterOverflow` #3, feedback
   `CounterOverflow` #4, proof-registry `CounterOverflow` #3, reputation
   `ScoreOverflow` #3 (additive).
7. **reputation Score TTL** — 30 → 90 days (behavioral only, no decode
   change).
8. **deploy.sh** — now deploys all five contracts and prints the id block for
   `src/config/contract.ts` (`contractId`, `reputationId`, `feedbackId`,
   `proofRegistryId`); multisig has no `ContractSet` field yet and is printed
   separately.
