# Zentra — Load Test Harness

## 1. Status, and the only framing this may be read with

**The accounts this harness creates are synthetic. They are not users.** They are
keypairs minted by a script, funded by Friendbot, used for exactly one
transaction, and then abandoned. Nobody owns them, nobody chose to use Zentra,
and nothing about them survives the run.

So:

- **No number produced here is adoption.** Not the account count, not the
  distinct-author count, not the throughput.
- **No number produced here counts toward the 50-user target** in
  `docs/BELT-CHECKLIST.md`, or the 10-user one, or the 20 verified mainnet users.
  Those require real people. A load report is not partial credit toward them.
- **No load-test figure may appear in a pitch, a README table, or a screenshot
  of `/metrics`** presented as usage. If a number from this harness is quoted, it
  must be quoted as what it is: a synthetic concurrency measurement.

**Runs have now been performed**, against a throwaway pair on testnet. Their
findings are in §11 — and the first run found a real defect in `record()`, not a
performance number. Every example in §8 is still only a shape, and §8 says so
where the temptation to read it as data is strongest.

What the harness *is* good for: finding out where the write path gives out under
concurrency, and which layer gives out first. That is a real question the
contracts cannot answer on their own, and `scripts/loadtest/types.ts` explains
why the answer is broken down by stage rather than summed.

---

## 2. The isolated deployment is not optional

The harness refuses to start without explicit `--action-log` and `--reputation`
ids. There is no default, no fallback to `src/config/contract.ts`, and no flag
that supplies one. This is the single most important thing about running it.

Here is what a run against the **live** testnet ids in `src/config/contract.ts`
would do, permanently:

| Surface | What it reads | What a load run does to it |
| --- | --- | --- |
| `/metrics` action count | `get_count` on the live action log | Adds one per synthetic record. The page presents this as on-chain product usage |
| `/metrics` distinct wallets | Distinct authors seen on the live action log | Adds one per synthetic account. This is the number read as "how many wallets have interacted" |
| `/board` live feed | `get_recent`, capped at the newest 20 entries | A run of 25+ accounts fills the entire window. Every real user's action is pushed out of the feed for good |
| `docs/BELT-CHECKLIST.md` | The counts above | Inflates the one requirement the checklist is explicit about not fabricating |
| The reputation contract | `score_of` per author | Writes a score for every synthetic account |

**None of it is reversible.** A submitted transaction is in the ledger; there is
no delete, no filter, and no way to subtract the synthetic entries from a count
that is computed by reading the chain. `docs/MAINNET.md` §9 makes the same point
about mainnet, and it is just as true of the testnet instance the project
presents as its live deployment.

`scripts/loadtest/deploy-isolated.sh` exists so the correct thing is also the
easy thing. It deploys a fresh pair, wires them, verifies the wiring, and refuses
to hand them over unless `get_count` is `0` — because a fresh instance is the only
evidence available that the numbers a run reports belong to that run.

Deploy a new pair per run. They are free on testnet and abandoned afterwards.

---

## 3. Prerequisites

| Requirement | Why |
| --- | --- |
| `stellar` CLI, configured with a `testnet` network | Deploys the throwaway pair |
| A funded testnet identity (`stellar keys …`) | Pays for the two deployments and signs `set_logger` |
| Rust toolchain with the `wasm32v1-none` target | `stellar contract build` runs from the deploy script |
| `bun` | Runs the CLI |

The harness itself adds no dependencies. It uses `@stellar/stellar-sdk`, already
a project dependency, and nothing else.

---

## 4. The commands, in order

### 4.1 Deploy a throwaway pair

```bash
SOURCE=zentra-deployer ./scripts/loadtest/deploy-isolated.sh
```

It prints the two ids, verifies that the action log points at the reputation
contract it just deployed, verifies `get_count` is `0`, and prints a block telling
you not to paste the ids into `src/config/contract.ts`. Read that block.

The script's environment variables mirror `contracts/deploy.sh`:

| Variable | Default | Notes |
| --- | --- | --- |
| `NETWORK` | `testnet` | `public` / `mainnet` / `pubnet` are **refused**: a load run needs Friendbot, and mainnet history is permanent |
| `SOURCE` | `zentra-deployer` | The identity that pays for both deployments |
| `ADMIN` | `stellar keys address "$SOURCE"` | Recorded as the reputation contract's admin, once, forever |
| `ADMIN_SIGNER` | `$SOURCE` | The key that **signs** `set_logger`. `Reputation::set_logger` calls `admin.require_auth()`, so if you override `ADMIN` with a separately-custodied account, this must be that account's key or the invoke fails the auth check. Same subtlety, and same default, as `contracts/deploy.sh` |

Why the script wires the logger rather than leaving it to you: `ActionLog::record`
wraps its cross-contract bump in `try_bump` and degrades to a score of `0` instead
of trapping (the ZEN-01 comment in `contracts/zentra-action-log/src/lib.rs`). An
unwired pair therefore records every action *successfully*, with every score `0`.
The run would look fine and would have measured the cheaper degraded path instead
of the cross-contract one.

### 4.2 Run it

```bash
export LOADTEST_ACTION_LOG_ID=C…       # printed by the script above
export LOADTEST_REPUTATION_ID=C…

bun scripts/loadtest/run.ts --accounts 25 --concurrency 5
```

Or entirely on the command line, with no environment at all:

```bash
bun scripts/loadtest/run.ts \
  --action-log C… \
  --reputation C… \
  --accounts 25 --concurrency 5
```

`bun scripts/loadtest/run.ts --help` prints the same flag list as §5.

### 4.3 Read the report

```bash
cat out/loadtest/report.md
jq '{recordsSucceeded, recordsFailed, failuresByStage, notes}' out/loadtest/report.json
```

`report.json` and `report.md` are rendered from the same `LoadTestReport`
structure, so the prose and the data cannot drift apart. The default output
directory sits inside the already-gitignored `/out/`, so a report cannot be
committed by accident.

### 4.4 There is no cleanup step

The throwaway contracts cannot be deleted — nothing on Soroban can. They sit
there until their 30-day instance TTL lapses and the instance is archived, after
which reads against them fail. That is the intended end state. Do not extend
their TTL.

---

## 5. Configuration

Precedence is **flag → environment variable → default**. A blank environment
variable counts as absent.

| Flag | Environment variable | Default | Bounds / notes |
| --- | --- | --- | --- |
| `--action-log` | `LOADTEST_ACTION_LOG_ID` | **none — required** | `C` + 55 base32 chars. §2 is why there is no default |
| `--reputation` | `LOADTEST_REPUTATION_ID` | **none — required** | Same format. Must differ from `--action-log` |
| `--accounts` | `LOADTEST_ACCOUNTS` | `10` | 1–500. The ceiling is a typo limit, not a performance one: 5000 Friendbot calls against a shared public testnet is closer to abuse than measurement |
| `--concurrency` | `LOADTEST_CONCURRENCY` | `5` | 1–25. Past that the run measures Friendbot's rate limiter and the RPC's, which is the one result the harness cannot use |
| `--message` | `LOADTEST_MESSAGE` | `zentra load test` | 1–200 **UTF-8 bytes**. See below |
| `--timeout-ms` | `LOADTEST_TIMEOUT_MS` | `60000` | 5000–300000. Per-operation ceiling, so one stuck submission cannot hang the run |
| `--rpc-url` | `LOADTEST_RPC_URL` | `https://soroban-testnet.stellar.org` | Must parse, and must be `http`/`https` |
| `--friendbot-url` | `LOADTEST_FRIENDBOT_URL` | `https://friendbot.stellar.org` | Same |
| `--network-passphrase` | `LOADTEST_NETWORK_PASSPHRASE` | the SDK's testnet passphrase | Taken from `@stellar/stellar-sdk`, never typed by hand — a passphrase wrong by one character produces signatures the network rejects with an error that names neither |
| `--out` | `LOADTEST_OUT_DIR` | `out/loadtest` | Created if absent. `report.json` and `report.md` are written into it |
| `--verbose` | — | off | One line per attempt. Public keys only — see §9 |
| `--help` | — | — | Flags and exit codes |

On the message limit: the contract checks `soroban_sdk::String::len()`, which is a
**byte** count, against `MAX_MESSAGE_LEN = 200`. ASCII makes bytes and characters
identical; one emoji does not. The CLI checks bytes for that reason, so a
too-long message is refused before any account is funded rather than after all of
them are.

---

## 6. What it refuses before spending anything

Validation runs before the first network call, collects **every** problem, and
prints them together. Nothing is funded, deployed or signed on this path.

- Missing or malformed `--action-log` / `--reputation`, or the two being equal.
- `--accounts` or `--concurrency` non-integer, zero, negative, or over the bound.
- `--timeout-ms` outside 5000–300000.
- An empty message (the contract answers `EmptyMessage`) or one over 200 bytes
  (`MessageTooLong`).
- An unparseable `--rpc-url` / `--friendbot-url`, or one that is not `http`/`https`.
- An empty `--network-passphrase`.
- An unknown flag. `--acounts 400` is an error, not a silent run of 10 — a report
  that honestly describes a run nobody asked for is worse than no report.

Exit code `2`, and the first line says nothing has been spent.

---

## 7. Reading the report

### 7.1 Failure stages

`FailureStage` is deliberately granular, because the useful question after a run
is *which layer gave out*. Collapsing these into one error count hides the
distinction that makes the run worth doing.

| Stage | What failed | What it tells you |
| --- | --- | --- |
| `keypair` | Generating a keypair locally | A bug or an exhausted entropy source. Never the network |
| `funding` | The Friendbot call | **Infrastructure, not the contracts.** Friendbot rate-limits by source IP. Lower `--concurrency` or rerun; do not read it as a contract result |
| `build` | Assembling or simulating the transaction | Simulation rejects before submission — a bad contract id, an unwired pair, or a contract error surfaced early. Also where the orchestrator files an attempt whose driver threw without classifying itself; the message says so when that is the cause |
| `sign` | Local signing | A bug. Signing is offline arithmetic |
| `submit` | Handing the transaction to the RPC | The RPC refused or was unreachable: throttling, a bad sequence number, too low a fee |
| `confirm` | Waiting for the ledger to include it | **The contracts or the network rejecting real work.** This is the interesting one — the only stage that says something about the system under test rather than about the plumbing around it |

A run whose failures are all `funding` measured Friendbot. A run whose failures
are all `confirm` measured Zentra. They are not comparable and the report keeps
them apart on purpose.

### 7.2 `distinctAuthorsSeen` is a floor, never a total

`ActionLog::get_recent` clamps its own limit to `MAX_RECENT = 20`, whatever you
ask for. So the distinct-author count is derived from at most the newest 20
entries:

- A run of 25 accounts **cannot see 25 of its own authors.** The maximum readable
  answer is 20, and 20 does not mean "20 succeeded".
- Read it as: *at least this many distinct authors were visible in the newest 20
  entries.* `recordsSucceeded` is the harness's own count of what landed;
  `distinctAuthorsSeen` is an independent, capped, on-chain cross-check of it.
- If the instance had prior history, the newest 20 may include authors that
  predate the run. The harness emits a note when it detects that.
- `null` means the read failed. It never means zero. `LoadTestReport` models the
  two separately because they mean opposite things: `0` is a measurement, `null`
  is the absence of one.

The same applies to `actionLogCountBefore` / `actionLogCountAfter`. When both are
readable, the harness compares their delta against its own success count and adds
a note if they disagree — which means either something else wrote to the instance
during the run (so it was not isolated), or an attempt landed after being counted
as failed.

### 7.3 `notes`

Every note is gated on something the harness actually observed, so a note that is
present is evidence rather than boilerplate. The one exception is the framing note
from §1, which is true of every run by construction and is the note that must
never be missing.

Notes appear for, among others: a non-zero count before the run (the instance was
not fresh), funding failures (Friendbot throttling), a run larger than the
`get_recent` cap (the author floor), unreadable counts, a count delta that
disagrees with the success count, `confirm` failures, watchdog cut-offs, and a
partial run.

### 7.4 Exit codes

| Code | Meaning |
| --- | --- |
| `0` | At least one record landed. The run measured something |
| `1` | Zero records succeeded, **or** the process failed outright. The report was still written if the run got far enough to produce one |
| `2` | The run was refused during validation. Nothing was spent |

A partial run — 40 of 50 funded, 31 landed — exits `0`. The shortfall belongs in
the report, not in the exit code; CI only needs the one bit.

---

## 8. Illustrative report shape — not measured output

Nothing has been run. The following is the **structure** of `report.json`, with
type placeholders where values would go. It is written this way deliberately:
plausible-looking numbers in a document get quoted as results.

```json
{
  "startedAt":  "<ISO 8601 UTC>",
  "finishedAt": "<ISO 8601 UTC>",
  "durationMs": "<number>",
  "config":     "<the LoadTestConfig echoed back — contains no secrets by construction>",
  "accountsRequested": "<number>",
  "accountsFunded":    "<number, ≤ accountsRequested>",
  "recordsAttempted":  "<number, = accountsFunded>",
  "recordsSucceeded":  "<number>",
  "recordsFailed":     "<number>",
  "throughputPerSecond": "<successes ÷ duration>",
  "latency": {
    "count": "<number of samples>",
    "minMs": "<number>", "p50Ms": "<number>", "p95Ms": "<number>",
    "p99Ms": "<number>", "maxMs": "<number>", "meanMs": "<number>"
  },
  "failuresByStage": {
    "keypair": "<number>", "funding": "<number>", "build": "<number>",
    "sign":    "<number>", "submit":  "<number>", "confirm": "<number>"
  },
  "actionLogCountBefore": "<number, or null when unreadable>",
  "actionLogCountAfter":  "<number, or null when unreadable>",
  "distinctAuthorsSeen":  "<number — a floor, capped at 20 — or null>",
  "notes": ["<caveats true of that run>"]
}
```

`report.md` renders the same fields. If you need a worked example with real
numbers, run the harness and read your own report; do not borrow one.

---

## 9. Secrets

A run mints a secret seed per account. They sign one transaction each and are
worthless afterwards, but they never leave the process:

- `LoadTestReport` has nowhere to put a secret. That is a property of the type,
  not a habit of the code.
- The CLI reads exactly one field of a funded account: `publicKey`. It never
  serialises an account, spreads one into a log line, or stringifies one.
- `--verbose` prints public keys, latencies, stages and transaction hashes. All
  of those are chain-public. There is no verbosity level that prints a seed.
- No secret is written to `out/loadtest/` or anywhere else on disk.

---

## 10. What this harness does not tell you

Stated plainly, because a load-test report reads as more authoritative than it is.

1. **It is not a benchmark of Stellar.** Testnet is shared, throttled, and reset
   periodically. Its latencies are not mainnet's, and resource pricing differs
   between networks — `docs/MAINNET.md` §4.2 makes the same point about fees.
2. **At scale, Friendbot is the bottleneck, not the contracts.** Provisioning is
   the most fragile phase and the least interesting one. That is why `funding`
   has its own stage.
3. **One record per account.** It measures a first write from a cold account, not
   sustained per-account throughput, and not the cost of the second write to a
   contract whose instance TTL was already extended.
4. **Percentiles need samples.** A `p99` over 10 attempts is the maximum with a
   more impressive name. Treat percentiles as meaningful only when
   `latency.count` is large enough to support them.
5. **Latency is measured from the client.** It includes RPC round trips, retries
   and confirmation polling. It is not contract execution time and says nothing
   about resource fees — nothing here measures what a write costs.
6. **It exercises the contracts only.** Not `/api/*`, not the database, not the
   frontend, not the rate limiters. A green load report says nothing about
   whether the product holds up.
7. **It does not run in CI**, and should not: it spends testnet lumens, depends on
   Friendbot's availability, and deploys contracts. It is a thing a person runs
   deliberately.
8. **It cannot prove isolation, only check for evidence against it.** A zero
   `get_count` at deploy time and a matching delta afterwards are consistent with
   an isolated instance. They do not prove the id you passed is not read by
   something you forgot about.

---

## 11. Findings from the runs performed

Three runs on 2026-07-30 against a throwaway pair on testnet
(`action_log CCV53CH3RHOJLVSSHZPBB4WK6XUDOSJHJ6IDMMM3NAXQFSQ4VJPFMHQB`,
`reputation CAB4ZA45J5NNC75XNKONFYSSQBC2FYY567Y47BWEADQXUVFLQ7WLWJ6A`,
deployed fresh with `get_count = 0` and its reputation pointer verified).

### 11.1 `record()` serialises to one write per ledger

| Accounts | Concurrency | Succeeded | Rate | Failures |
| --- | --- | --- | --- | --- |
| 50 | 5 | 10 | 20% | `confirm` × 40 |
| 4 | 2 | 2 | 50% | `confirm` × 2 |
| 5 | 1 | 5 | 100% | none |

Funding was never the constraint: **50 of 50 accounts funded, zero failures.**
Every failure was at `confirm` — accepted by the network, then failed on apply.

The success rate is `1 / concurrency`. One transaction per ledger lands; the rest
trap. Decoded, a failure is:

```
$ stellar xdr decode --type TransactionResult --input single-base64
{"fee_charged":"13890","result":{"tx_failed":[{"op_inner":{"invoke_host_function":"trapped"}}]}}
```

`trapped` — the contract panicked rather than returning one of its own `Error`
variants, which is why nothing in `contracts/zentra-action-log/src/lib.rs`'s error
enum describes it and why the dApp can only report a generic failure.

### 11.2 Why

`record()` derives a **storage key** from a counter it reads at simulation time:

```rust
let index: u64 = env.storage().instance().get(&DataKey::Count).unwrap_or(0);
...
env.storage().persistent().set(&DataKey::Entry(index), &entry);
```

Soroban requires every write to be declared in the transaction's footprint, and
the footprint is fixed at simulation. So for two concurrent callers:

1. Both simulate against `Count = 10`. Both footprints declare a write to `Entry(10)`.
2. The first applies: `Entry(10)` is written, `Count` becomes 11.
3. The second applies, now reads `Count = 11`, and attempts `Entry(11)` — a key
   its footprint never declared. Writing outside the footprint traps.

The trap is doing its job: it is what stops the second caller from overwriting
`Entry(10)` and losing an entry. The defect is using a mutable shared counter as
a key at all, which makes concurrent writes mutually exclusive by construction.

### 11.3 What it means for the product

- **Two users recording in the same ~5s ledger means one fails**, with no message
  explaining why. At sparse traffic this is invisible; at any real concurrency it
  is the dominant outcome.
- **It is a cheap griefing vector.** One account recording every ledger keeps
  every other write trapping, for the price of one transaction per ledger.
- `docs/ARCHITECTURE.md`'s throughput expectations for the action log do not
  account for this, and no test covered it — the contract's own tests are
  sequential, which is exactly why 38 passing tests never caught it.

### 11.4 Fixes, none applied yet

1. **Key entries so concurrent authors cannot contend** — per-author sequence, or
   a client-supplied unique id. Removes the shared mutable key entirely. Requires
   a redeploy, and `docs/MAINNET.md` §11 records that there is no upgrade path, so
   the live instance's history would be orphaned.
2. **Retry with re-simulation in the dApp.** Re-simulating produces a fresh
   footprint that succeeds. It costs a second wallet signature, because the user
   signed an envelope built for the old index.
3. **Accept and document it**, keeping `Count` as-is. Honest, and adequate while
   traffic is sparse, but the griefing vector remains.
