# Zentra — Security Review

An internal review of the contracts, the API and the browser client in this
repository. It is written to be checked: every finding names a file and the
behaviour that produces it, and every claim of a mitigation quotes the code that
provides it.

---

## 1. Scope and method

| | |
| --- | --- |
| Repository | `zentra-docs` (this repository) |
| Branch | `Setup-1` |
| Commit | `db6fd4105fc4bd2a79dea0c425da0431d6a3f713` |
| Note on the moving target | The repository advanced during this review, from `e6368df` to `db6fd41`. Between those commits a fee-sponsorship endpoint carrying a **server-side signing key** (`SPONSOR_SECRET`), a fifth contract (`zentra-multisig`), a per-network config split, and a chain-aware health probe were added. The findings below describe the code at `db6fd41`, the current HEAD, not the commit the review opened on — reviewing the earlier snapshot would have published claims that no longer match the tree. |
| Method | Manual source reading. No dynamic testing, no fuzzing, no instrumentation. |

### In scope

- **Contracts** — `contracts/zentra-action-log`, `zentra-reputation`,
  `zentra-feedback`, `zentra-proof-registry`, and (added mid-review)
  `zentra-multisig`: `src/lib.rs` and `src/test.rs` for each, plus `Cargo.toml`
  release profiles and `contracts/deploy.sh`.
- **Backend** — `src/lib/api/*` (`auth`, `validation`, `rate-limit`,
  `verify-anchor`, `moderation`, `errors`, `route`, `logger`, `client`,
  `sponsor`), `src/lib/db.ts`, every handler under `src/app/api/**` (including
  `sponsor`), and `db/schema.sql` with both migrations.
- **Client** — `src/lib/stellar/*`, `src/lib/zk/*`, `public/zk-worker.js`,
  `public/zk/*`, `src/components/app/*`, `src/components/playground/*`,
  `next.config.mjs`.
- **Configuration** — `.env.example`, `.gitignore`, `git ls-files`, the git
  history of every path matching `*.env*`, `package.json`, `.github/workflows/ci.yml`.

### Explicitly not in scope

- **No mainnet deployment.** Everything reviewed targets Stellar testnet. No
  mainnet contract exists to review.
- **No formal verification.** No proofs of contract state invariants, no model
  checking, no symbolic execution.
- **No third-party audit.** Nobody outside the project has looked at this code.
- **No live penetration test.** Nothing was exercised against the deployed site,
  the deployed contracts, or the Neon database. No findings below were confirmed
  by execution; all are derived from reading the source.
- **No cryptographic review of the circuit.** The Circom payment-policy circuit
  and the Groth16 trusted setup live in the `zentra-protocol` repository and were
  not examined. This review treats `public/zk/*` as opaque artefacts and asks
  only how they are delivered and trusted — not whether the circuit is sound.
- **No dependency CVE sweep.** No `cargo audit`, `bun audit` or SCA tool was run.
- **No review of the on-chain ZentraVerifier.** It lives in the other repository
  and, per `README.md`, its verifying key predates the current circuit build.

### What this document is not

This is an internal self-review by the people who wrote the code. It is not an
independent audit and it does not substitute for one. A reviewer who wrote a
module is the worst possible person to find its blind spots, and no amount of
diligence here changes that. **A professional third-party audit is a
prerequisite for mainnet, not an optional extra**, and item 1 of the pre-mainnet
checklist in §5 says so for that reason.

---

## 2. Summary

22 findings: **1 High, 5 Medium, 8 Low, 8 Informational**.

| Id | Title | Severity | Component | Status |
| --- | --- | --- | --- | --- |
| ZEN-01 | Reputation admin can permanently disable the Action Log | High | `zentra-reputation`, `zentra-action-log` | Mitigated |
| ZEN-02 | Instance TTL is extended only on the write path | Medium | All contracts | Open |
| ZEN-03 | The documented registry export writes personal data into a git-tracked file | Medium | `docs/users` | Open |
| ZEN-04 | Admin gate is one static secret, unthrottled, guarding a personal-data export | Medium | `src/lib/api/auth.ts`, admin routes | Mitigated |
| ZEN-05 | ZK artefacts have no integrity pinning; the in-browser verification is circular | Medium | `public/zk-worker.js`, `public/zk/*` | Open |
| ZEN-20 | The fee sponsor drains via unlimited legitimate-shaped calls, not the case the allowlist stops | Medium | `src/lib/api/sponsor.ts`, `src/app/api/sponsor/route.ts` | Open |
| ZEN-07 | Anchored commitments are neither verified nor unique | Low | `zentra-proof-registry` | Accepted |
| ZEN-08 | Signup conflict response is an email-membership oracle | Low | `src/app/api/onboard/route.ts` | Open |
| ZEN-09 | Off-chain feedback attributes an unproven wallet on the public feed | Low | `src/app/api/feedback/route.ts` | Accepted |
| ZEN-10 | Moderation is bypassable and cannot reach the on-chain copy | Low | `src/lib/api/moderation.ts`, `zentra-feedback` | Open |
| ZEN-11 | Unauthenticated anchor claims cost two Horizon calls and up to 7.5s of function time | Low | `src/app/api/feedback/route.ts` | Open |
| ZEN-12 | Write endpoints accept cross-origin simple requests; the rate-limit key is header-derived | Low | `src/lib/api/validation.ts`, `src/lib/api/rate-limit.ts` | Open |
| ZEN-13 | CSP omits directives the WebAssembly constraint does not actually block | Low | `next.config.mjs` | Open |
| ZEN-21 | `.env.example` and `ARCHITECTURE.md` still claim the server holds no signing key | Low | `.env.example`, `docs/ARCHITECTURE.md` | Fixed |
| ZEN-06 | The wallet kit no longer hardcodes the network; wallet-id persistence is still fixed to Freighter | Informational | `src/lib/stellar/kit.ts`, `src/components/app/wallet-provider.tsx` | Mitigated |
| ZEN-14 | Contract authorisation is never negatively tested | Informational | All `src/test.rs` | Open |
| ZEN-15 | On-chain storage grows without bound and cannot be pruned | Informational | All contracts | Open |
| ZEN-16 | `x-request-id` is caller-controlled and echoed to logs and response headers | Informational | `src/lib/api/route.ts` | Accepted |
| ZEN-17 | Rate limiting is per instance | Informational | `src/lib/api/rate-limit.ts` | Accepted |
| ZEN-18 | `verifyAnchor` depends on caller-side validation for its SSRF safety | Informational | `src/lib/api/verify-anchor.ts` | Mitigated |
| ZEN-19 | No dependency audit in CI; `snarkjs` is vendored outside the lockfile | Informational | `.github/workflows/ci.yml`, `public/zk/` | Open |
| ZEN-22 | The multisig contract is an approval board, not account-level custody | Informational | `zentra-multisig` | Open |

---

## 3. Findings

### ZEN-01 — Reputation admin can permanently disable the Action Log (High)

**Where.** `contracts/zentra-reputation/src/lib.rs:45–50` (`set_logger`) and
`contracts/zentra-action-log/src/lib.rs:65–67` (`__constructor`), `:92–94`
(the cross-contract call).

**What.** The Action Log stores the reputation contract address once, at
construction, and never again:

```rust
pub fn __constructor(env: Env, reputation: Address) {
    env.storage().instance().set(&DataKey::Reputation, &reputation);
}
```

There is no setter, no admin, and no upgrade path on the Action Log. Every
`record` call reaches into the reputation contract:

```rust
let score = ReputationClient::new(&env, &reputation)
    .bump(&env.current_contract_address(), &author);
```

The reputation contract, meanwhile, lets its admin repoint the authorised logger
at any time and any number of times:

```rust
pub fn set_logger(env: Env, logger: Address) {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
    admin.require_auth();
    env.storage().instance().set(&DataKey::Logger, &logger);
```

`set_logger` has no one-shot guard, no timelock, no event, and no second
signature. `bump` rejects any caller that is not the currently registered logger
(`:64–66`). The generated `ReputationClient::bump` is declared to return `u32`,
not a `Result`, so a rejection from the callee traps the whole invocation rather
than being handled.

**Exploitation.** One `set_logger` call from the admin key — pointed at any other
address, including a burn address — permanently breaks `record` for every user.
Each subsequent `record` reaches `bump`, gets `Error::Unauthorized`, and traps.
The Action Log cannot be repaired: its reputation pointer is immutable, so the
only remedy is deploying a new Action Log, which abandons every entry the
existing one holds and every contract id published in `src/config/contract.ts`,
the README and the docs site. `contracts/deploy.sh` defaults `ADMIN` to a single
local CLI identity (`SOURCE=zentra-deployer`), so the admin key is one ordinary
Stellar keypair on one machine.

**Impact.** Permanent, unrecoverable loss of the primary write path of the
flagship contract, from a single key and a single call. No funds are at risk and
no data is disclosed — the severity is driven entirely by irreversibility and by
the absence of any recovery mechanism, not by monetary loss. The same
key-custody weakness applies to every other privileged action the project takes.

**Recommendation.**
1. Give the Action Log an admin and a `set_reputation` so the pointer is
   recoverable, or make `record` degrade — call `try_bump` and record a score of
   the previous value rather than trapping when the reputation contract refuses.
2. Make `set_logger` emit an event so a repoint is visible in the ledger.
3. Put the deployer/admin key behind a multisig account (see §5).

**Status — Mitigated.** `record` now calls `try_bump` and records a degraded
score of 0 rather than trapping when the reputation contract refuses
(`zentra-action-log/src/lib.rs`), with a regression test that drives it through a
rejecting reputation stand-in (`record_degrades_when_reputation_rejects`). A
repoint can no longer brick the write path. `set_logger` now emits a `LoggerSet`
event (`zentra-reputation/src/lib.rs`), so a repoint is visible on the ledger.
Residual, and why this is not Closed: the reputation pointer is still immutable
(recommendation 1's first option was not taken), and the admin key is still a
single keypair — recommendation 3 is a mainnet gate in §5, not a code change.

---

### ZEN-02 — Instance TTL is extended only on the write path (Medium)

**Where.** `contracts/zentra-reputation/src/lib.rs:49` and `:71`;
`contracts/zentra-action-log/src/lib.rs:110–112`;
`contracts/zentra-feedback/src/lib.rs:93–95`;
`contracts/zentra-proof-registry/src/lib.rs:67–69`;
`contracts/zentra-multisig/src/lib.rs:103–112` (`save`).

**What.** Every contract sets `INSTANCE_BUMP = 30 * DAY_LEDGERS` (~30 days) and
calls `extend_ttl` on instance storage only inside a state-changing function.
The multisig follows the same pattern — `save` extends both entry and instance
TTL, but only on `propose`/`approve`/`execute`; its reads do not — so a signer
set that goes a month without a proposal archives with the rest.
The read functions — `get_count`, `get_entry`, `get_recent`, `summary`,
`score_of` — never extend anything.

The reputation contract is the sharp case. Its instance storage holds `Admin`
and `Logger`, and `extend_ttl(THRESHOLD, BUMP)` appears exactly once, in
`set_logger` (`:49`). `bump` extends only the per-author persistent `Score` key
(`:71`), never the instance:

```rust
let key = DataKey::Score(author.clone());
let score: u32 = env.storage().persistent().get(&key).unwrap_or(0) + 1;
env.storage().persistent().set(&key, &score);
env.storage().persistent().extend_ttl(&key, THRESHOLD, BUMP);
```

`contracts/deploy.sh` calls `set_logger` once at deployment and never again.

**Exploitation.** No attacker is needed; time is sufficient. Roughly 30 days
after the last `set_logger`, the reputation contract's instance entry can reach
the end of its TTL and be archived. From that point `bump` cannot execute, and
because ZEN-01 makes `record` trap on a failed `bump`, the Action Log stops
accepting writes too — until somebody submits a `RestoreFootprint` operation for
the archived entry. The same clock applies to each contract's own instance
entry: a contract with no writes for 30 days archives itself.

Entry data has the same shape at 90 days (`ENTRY_BUMP`). `get_recent` is written
as though an expired entry simply reads back absent:

```rust
let entry: Option<Entry> = env.storage().persistent().get(&DataKey::Entry(i));
if let Some(entry) = entry {
    out.push_back(entry);
}
taken += 1;
```

That branch does not provide the degradation it appears to. An archived
persistent entry is not absent, it is unreadable, and touching one fails the
invocation rather than yielding `None`. A secondary bug is visible in the same
loop regardless: `taken` is incremented for skipped indices, so a caller asking
for `limit` entries can receive fewer than `limit` even when more exist.

**Impact.** Availability. A quiet month takes the on-chain half of the product
offline until an operator notices and restores it, and the failure surfaces to
users as an unexplained transaction failure rather than as a maintenance notice.

**Recommendation.** Extend the instance TTL on every entry point including reads,
add an unprivileged `ping`/`touch` that any keeper can call, and monitor the
remaining TTL of each contract instance (see §5). Fix the `taken` counter so the
`limit` contract is honest.

---

### ZEN-03 — The documented registry export writes personal data into a git-tracked file (Medium)

**Where.** `docs/users/onboarding-responses.csv` (tracked — confirmed present in
`git ls-files`), `docs/users/README.md` §Exporting, and `.gitignore`, which has
no rule that would cover it.

**What.** `docs/users/README.md` documents the operator export procedure as:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://zentra-docs.vercel.app/api/admin/users \
  -o docs/users/onboarding-responses.csv
```

That endpoint returns `name, email, wallet, rating, note, source, created_at`
for every registered person (`src/app/api/admin/users/route.ts:36`, `:80–84`).
The output path is inside the repository and is a tracked file. `.gitignore`
covers `.env*.local`, build output and `*.pem`, but nothing under `docs/users/`.

**Current state.** The tracked file is header-only — one line, no data rows. No
personal data is presently committed, and no secret was ever committed:
`git log --all -- '*.env*'` shows only `.env.example`, and every historical
revision of it carries the placeholder
`postgresql://user:password@host.neon.tech/dbname?sslmode=require`.

**Exploitation.** No exploit is required — the next operator who follows the
documented procedure and commits their working tree publishes the registry. The
repository is public and git history is not retractable in any meaningful sense
once cloned or forked. The blast radius is every name, email address and wallet
in the `users` table, permanently.

**Impact.** Mass disclosure of personal data, with no way to undo it. It has not
happened; the procedure as written makes it a matter of when.

**Recommendation.** Add `docs/users/*.csv` to `.gitignore`, delete the tracked
placeholder, and rewrite the export command in `docs/users/README.md` to target a
path outside the repository. State in that file that exports must never be
committed.

---

### ZEN-04 — Admin gate is one static secret, unthrottled, guarding a personal-data export (Medium)

**Where.** `src/lib/api/auth.ts:57–74` (`requireAdmin`),
`src/app/api/admin/users/route.ts:53–73`,
`src/app/api/admin/feedback/route.ts:32–43`, and `docs/API.md` §5.

**What.** Both admin routes are gated by one process-wide bearer secret. Neither
route is rate limited; `docs/API.md` §5 states this plainly and gives the
rationale ("the shared secret is the control there"). Three properties compound:

1. **No throttling.** An attacker may guess `ADMIN_TOKEN` at whatever rate the
   platform will serve. The limiter in `src/lib/api/rate-limit.ts` is never
   applied to `/api/admin/*`.
2. **No entropy floor.** `.env.example` recommends `openssl rand -hex 32`, but
   `isAdminConfigured` and `requireAdmin` only require a non-blank string
   (`auth.ts:46`, `:59`). `ADMIN_TOKEN=admin` is accepted.
3. **No alerting.** Every refusal writes `admin.denied` with a reason
   (`auth.ts:114`), which is exactly the right log line, but nothing consumes it.
   A sustained guessing campaign produces a large volume of warn lines and no
   notification.

The thing being guarded is the full personal-data registry.

**Mitigations already present, and they are real.** The gate fails closed: an
absent or blank secret denies every request with a 503 before any credential is
examined, so there is no header value that opens an unconfigured deployment
(`auth.ts:58–61`). The comparison is length-hardened and accumulator-based
rather than short-circuiting (`auth.ts:96–105`), and the module's own docstring
is honest about the limit of that — *"This reduces the timing side channel
rather than eliminating it: JavaScript string comparison cannot be made truly
constant-time."* Neither the supplied nor the expected token is ever logged, and
`src/lib/api/__tests__/auth.test.ts` contains explicit tests for that
(`never writes the expected secret or the supplied token to any line`, `does not
leak the secret even as a truncated fragment`). `docs/API.md` §10 already
documents the single-secret, no-rotation, no-per-person-identity limitation.

**Impact.** With a properly generated 256-bit secret, brute force is not a
practical threat and this finding is largely about operational posture. With a
weak or reused secret — which nothing in the code prevents — an unauthenticated
attacker reads every registered person's name, email and wallet. That is the
worst outcome available anywhere in this system.

**Recommendation.** Rate limit `/api/admin/*` by IP with a low ceiling; reject
an `ADMIN_TOKEN` shorter than 32 characters at startup; alert on a threshold of
`admin.denied` lines; replace the shared secret with per-operator credentials
before a second operator exists.

**Status — Mitigated.** `requireAdmin` now throttles by caller IP before the
token is compared — 10 attempts per 10 minutes, returning `429` (`src/lib/api/
auth.ts`), so the timing-safe compare is no longer the only thing standing
between an attacker and unlimited online guesses. Residual: still one shared
static secret (per-operator credentials remain a design change for when a second
operator exists), the limiter is per-instance like every other (ZEN-17), and no
minimum-length check is enforced on the token yet.

---

### ZEN-05 — ZK artefacts have no integrity pinning; the in-browser verification is circular (Medium)

**Where.** `public/zk-worker.js:5`, `:11–19`; `public/zk/` (`snarkjs.min.js`
688 KB, `payment_policy.wasm` 3.2 MB, `payment_policy.zkey` 2.3 MB,
`verification_key.json`); `src/lib/zk/prover.ts:28–52`.

**What.** The worker loads its entire toolchain by path, with no integrity
metadata anywhere:

```js
importScripts('/zk/snarkjs.min.js');
...
const { proof, publicSignals } = await self.snarkjs.groth16.fullProve(
  input, '/zk/payment_policy.wasm', '/zk/payment_policy.zkey',
);
const vk = await fetch('/zk/verification_key.json').then((r) => r.json());
const verified = await self.snarkjs.groth16.verify(vk, publicSignals, proof);
```

Three separate problems:

1. **No subresource integrity.** `grep -rn "integrity=" src/ public/` returns
   nothing. Nothing in the build or in CI records a hash of any artefact under
   `public/zk/`, so a tampered `.zkey`, `.wasm` or `.js` reaching the origin is
   not detectable by the client, by the build, or by review.
2. **The verification is circular.** `verified` is computed against a verifying
   key fetched from the same origin as the proving key. An attacker who can
   modify `payment_policy.zkey` can modify `verification_key.json` to match, and
   the UI still shows a green result. A local `verify` proves the artefacts are
   internally consistent; it proves nothing about whether they correspond to the
   published circuit.
3. **`snarkjs` is vendored outside the lockfile.** `package.json` lists
   `snarkjs: ^0.7.6` as a dependency, but the worker does not use it — it
   executes a hand-placed minified bundle at `public/zk/snarkjs.min.js`
   (SHA-256 `3f61bbd9ac0a10173902eaef65b510fa4e9a2c057f759c7f18a6d0446b20fd06`).
   That file carries no version string and no provenance record, so `bun.lock`
   pins a copy of snarkjs that never runs, while the copy that does run is
   outside dependency management entirely.

**Exploitation.** Any write access to the deployed `public/` tree — a
compromised Vercel token, a malicious dependency in the build, a bad merge —
replaces the prover with code that exfiltrates the witness. The witness is the
private data: `docs/ARCHITECTURE.md` §8 states the reason proving happens in the
browser at all is that *"the witness contains the private policy and salts, so it
should never leave the user's machine."* The playground's whole privacy claim
rests on artefacts nothing verifies. The absent `script-src` CSP (ZEN-13) does
not help here: `importScripts` is same-origin, which any realistic policy would
permit.

**Impact.** Compromise of the one property the ZK playground exists to
demonstrate, with no detection. This does not require a novel attack — only
write access to static assets, which is the least-guarded part of most deploys.

**Recommendation.** Record the SHA-256 of every file in `public/zk/` in the
repository, verify them in CI, and have the worker check the digest of each
artefact after fetching it and before use. Record the exact snarkjs version and
its upstream release hash, or build the worker bundle from the locked npm
dependency so the lockfile governs what actually executes. State in the UI that
client-side `verified` means "consistent with the shipped verifying key" and not
"verified against the on-chain verifier" — which is the accurate claim until
on-chain pairing re-verification ships.

---

### ZEN-20 — The fee sponsor drains via unlimited legitimate-shaped calls, not the case the allowlist stops (Medium)

**Where.** `src/lib/api/sponsor.ts:71–93` (`SPONSORABLE_CONTRACT_IDS`,
`inspectInnerTransaction`), `:187–212` (`buildFeeBump`),
`src/app/api/sponsor/route.ts:48–57` (`WRITE_LIMIT`), `:81–127`.

**What.** `POST /api/sponsor` takes a user-signed inner transaction and returns
it wrapped in a fee-bump signed by `SPONSOR_SECRET`, so the sponsor account pays
the fee. The endpoint's stated security model is the contract allowlist. Its own
comment (`sponsor.ts:76–81`) frames the allowlist as the thing that stops the
account being drained:

> *Restricting the target of every operation to our own contracts is what turns
> "we pay for anything" into "we pay for our own product being used".*

That is exactly the distinction that leaves a gap. The allowlist stops the
*theft-shaped* drain — paying for a stranger's payment, account merge, or Wasm
upload. It does nothing about the *usage-shaped* drain, because "our own product
being used" is itself unbounded and free to the attacker. Every operation in
`SPONSORABLE_CONTRACT_IDS` — `record`, `anchor`, `submit`, and the multisig
calls — requires only the caller's own `require_auth`, which the attacker
supplies by signing the inner transaction as themselves. Nothing in `record` or
`anchor` costs the caller anything but a fee we are volunteering to pay.

The route comment concedes the limiter is not the defence
(`route.ts:53–55`: *"a speed bump rather than a guarantee — the contract
allowlist … is what actually stops the balance being drained"*), and the
allowlist is not the defence against this drain either. So nothing robust stops
it. The residual throttle is `WRITE_LIMIT` = 5 per 10 minutes per IP per
instance, which ZEN-12 (attacker-chosen `x-forwarded-for`) and ZEN-17
(per-instance counters) both weaken to a formality.

The per-request cost is bounded but not small. `MAX_SPONSORED_FEE_STROOPS` caps
the inner bid at 0.1 XLM, and `feeBumpBaseFee` bids that per operation on the
bump, so a single-operation inner transaction at the ceiling yields a bump
declaring `baseFee × (operations + 1)` ≈ 0.2 XLM (the module documents this
doubling at `:48–56`). The ledger charges what inclusion required rather than
the bid, so ordinary use is far cheaper — but the worst-case per grant is ~0.2
XLM, and an attacker chooses the worst case.

**Exploitation.** Script valid `anchor` (or `record`) invocations signed by
throwaway accounts, post each to `/api/sponsor` with a fresh `x-forwarded-for`,
submit the returned bump. Each accepted grant spends sponsor lumens for a
write the attacker wanted for free. Repeat until the balance the operator was
told to keep small (`.env.example`, `sponsor.ts:24–27`) is gone, at which point
the gasless path is down for real users.

**Impact.** Economic. Drains the one server-held account that holds real value,
and denies the gasless feature. Not theft — no attacker gains funds — and
bounded by how much the account is funded, which the documentation is
insistent should be little. That funding discipline is what holds the severity
at Medium rather than higher.

**Mitigations already present, and they are strong.** The allowlist genuinely
closes the theft-shaped drain, which is the larger risk. The secret is loaded
per call and never memoised so a rotation takes effect immediately
(`:187–196`); every `Keypair.fromSecret` is inside a `try`/`catch` that discards
the thrown value so a malformed secret cannot reach a stack (`:227–237`); the
endpoint fails closed when unconfigured (`route.ts:86–92`); it refuses an
already-bumped envelope, a wrong-network transaction, an empty operation list,
and an over-cap fee (`:142–162`); and it returns the signed envelope for the
client to broadcast rather than broadcasting itself, so the server is never the
ambiguous "did the fee move" path (`route.ts:118–126`). The XDR and the secret
are never logged. This is careful work; the finding is that one class of drain
falls outside the barrier the comments name as total.

**Recommendation.** Add a per-account (inner-transaction source) budget backed
by the same shared store §5 calls for, so a single actor cannot exceed a daily
lumen ceiling regardless of IP. Alert on sponsor balance drop and on
`sponsor.granted` rate. State in the module comment that the allowlist bounds
*what* is paid for, not *how much* — the current wording overstates it.

---

### ZEN-07 — Anchored commitments are neither verified nor unique (Low)

**Where.** `contracts/zentra-proof-registry/src/lib.rs:48–79` (`anchor`);
`contracts/zentra-proof-registry/src/test.rs:22–31`.

**What.** `anchor` takes an arbitrary `BytesN<32>` and an arbitrary `u32` signal
count, requires only that the prover authorises their own call, and stores it:

```rust
pub fn anchor(env: Env, prover: Address, commitment: BytesN<32>, signals: u32) -> u64 {
    prover.require_auth();
```

There is no proof, no verification and no uniqueness constraint. The contract's
own test asserts that duplicates are accepted:

```rust
client.anchor(&prover, &commitment, &14);
client.anchor(&prover, &commitment, &14);
assert_eq!(client.get_count(), 2);
```

Commitments are published in the `Anchored` event and readable via `get_recent`,
so anyone can copy one from the public feed and anchor it under their own
address.

**Impact.** The proof feed shown on `/playground` — described in `README.md` as
*"the live feed shows every proof made on the platform"* — carries no evidence
that the anchoring account generated anything. An entry proves only that some
account paid a fee to write 32 bytes. Nothing else in the system consumes these
entries, no funds or access depend on them, and the count is presentational,
which is why this is Low rather than higher.

**Status: Accepted.** `docs/ARCHITECTURE.md` §9 already states *"Anchoring is a
commitment, not on-chain verification. The proof registry stores a SHA-256 digest
of the public signals. Nothing in this repository re-verifies the Groth16 pairing
on-chain."* The copy/replay consequence of that decision is not documented and
should be.

**Recommendation.** State in the playground UI and in `README.md` that an anchor
records a claim, not a verified proof. When on-chain verification ships, reject
a commitment already present, or key entries by `(prover, commitment)` so a copy
is visibly a copy.

---

### ZEN-08 — Signup conflict response is an email-membership oracle (Low)

**Where.** `src/app/api/onboard/route.ts:117–136` and
`src/lib/api/validation.ts:43`, `:167–172`.

**What.** The route deliberately merges the two unique-violation cases into one
message, and says why:

```ts
// Which of the two collided is not reported: confirming that a given
// address is already registered would turn this into a lookup oracle.
if (isUniqueViolation(error)) {
  throw conflict('This email or wallet is already registered.');
}
```

The intent is right and the merge does not achieve it, because the attacker
controls the other unique key. `wallet` is validated by shape only —
`/^G[A-Z2-7]{55}$/` — with no strkey checksum check, so any random 56-character
base32 string starting with `G` passes both the API regex and the
`users_wallet_format` CHECK in `db/schema.sql`. Submitting a target email with a
freshly-invented wallet makes the wallet collision impossible by construction, so
a `409` can only mean the email is registered and a `201` can only mean it is
not.

**Exploitation.** `POST /api/onboard` with `{name, email: <target>, wallet:
<random valid-shape G…>}`. A `409` confirms the address is enrolled. Note the
oracle is destructive on a miss: a non-registered email is inserted into the
registry by the probe. Rate limiting slows this to 3 attempts per 10 minutes per
IP per instance (ZEN-17), which is a speed bump, not a barrier.

**Impact.** Confirms whether a specific known email address is a Zentra user.
Low: it does not enumerate, it requires the address in advance, and the
population is small and self-selected. The shape-only wallet check separately
means `users_wallet_unique_idx` guarantees uniqueness of strings, not of
accounts.

**Recommendation.** Answer both the created and the conflicting case with the
same `201`-shaped response and reconcile duplicates asynchronously, or require
proof of email control before the row is durable. Validate the strkey checksum
with `StrKey.isValidEd25519PublicKey` rather than a regex.

---

### ZEN-09 — Off-chain feedback attributes an unproven wallet on the public feed (Low)

**Where.** `src/app/api/feedback/route.ts:73–100`,
`src/lib/api/validation.ts:102–109`, `:127–135`, and
`src/components/app/feedback-summary.tsx` (the `recent` list renders `wallet`).

**What.** `parseFeedbackInput` accepts any well-formed `G…` string in `wallet`
and stores it. Ownership is proven only along the `onChain` path, and only there:

```ts
onChain: Boolean(body.onChain) && txHash !== null,
```

with `confirmAnchor` (`:113–136`) resolving the hash against Horizon and
requiring the source account to equal the claimed wallet
(`src/lib/api/verify-anchor.ts:94`). A submission with `onChain: false` and
someone else's wallet is stored as sent, and `GET /api/feedback` returns that
wallet alongside the comment for public display.

**Exploitation.** Post an abusive or discrediting comment carrying a third
party's public Stellar address. It appears on `/metrics` attributed to them,
without the on-chain badge.

**Impact.** Reputational, on a public feedback wall on testnet, with no funds or
access involved. The absent badge is a real distinguisher for an attentive
reader and a weak one for a casual one.

**Status: Accepted.** `docs/ARCHITECTURE.md` §9 and `docs/API.md` §10 both state
that an unanchored `wallet` is self-reported and that binding it would need a
signed challenge. The display consequence — that the unproven address is shown
next to the comment — is not stated in either place.

**Recommendation.** Do not render a wallet that failed or skipped anchor
verification; show "unverified" instead. If attribution matters, implement the
signed-challenge flow the docs already name.

---

### ZEN-10 — Moderation is bypassable and cannot reach the on-chain copy (Low)

**Where.** `src/lib/api/moderation.ts:132–151`, `:163–172`;
`src/components/app/feedback-form.tsx:44–55`;
`contracts/zentra-feedback/src/lib.rs:60–105`.

**What.** Two independent gaps.

**Normalisation defeats whole-word matching.** `normaliseForMatching` collapses
every non-alphanumeric character to a space (`:170`,
`NON_ALPHANUMERIC = /[^a-z0-9]+/g`), and `buildTermPattern` anchors each term
with `\b…\b` (`:191`). Any separator inserted inside a word therefore splits it
into tokens that no pattern matches: `f.u.c.k` normalises to `f u c k`. Zero-width
and combining characters that survive to that stage behave the same way. The
module handles the evasions it set out to handle — case, diacritics, leetspeak,
repeated letters — and this one is outside that set.

**Moderation runs after the content is already immutable.** The client anchors
first and calls the API second:

```ts
if (address) {
  const xdr = await buildFeedbackXdr(address, rating, trimmed);
  const signed = await signTransaction(xdr);
  txHash = await submitInvoke(signed);
  onChain = true;
}
const res = await fetch('/api/feedback', { ... });
```

`zentra-feedback::submit` stores the raw comment with no screening of any kind
and no hide flag, and `get_recent` serves it to any reader. `hidden` in Postgres
and `PATCH /api/admin/feedback` govern the site's own feed only. A comment
withheld from `/metrics` remains permanently readable on-chain.

**Impact.** Low. The site does not currently render on-chain comments — 
`getFeedbackAuthors` (`src/lib/stellar/feedback.ts:57–63`) reads authors only —
so the exposure is to anyone reading the ledger directly, not to site visitors.
The design is nonetheless unable to deliver what a moderation control implies.

**Recommendation.** Match terms against the letters-only reduction as well as the
token reduction. State in the UI, before the wallet prompt, that an anchored
comment is permanent and public and cannot be moderated or deleted.

---

### ZEN-11 — Unauthenticated anchor claims cost two Horizon calls and up to 7.5s of function time (Low)

**Where.** `src/app/api/feedback/route.ts:113–136` (`confirmAnchor`), `:54`
(`ANCHOR_RETRY_DELAY_MS`), `src/lib/api/verify-anchor.ts:26`
(`ANCHOR_TIMEOUT_MS`).

**What.** A `not_found` verdict triggers a fixed sleep and a second lookup:

```ts
if (!verdict.verified && verdict.reason === 'not_found') {
  await delay(ANCHOR_RETRY_DELAY_MS);
  verdict = await verifyAnchor(input.txHash, input.wallet);
}
```

The reason given is sound — Horizon ingestion lag should not penalise an honest
user. The cost is that any unauthenticated caller who posts a syntactically
valid but non-existent hash forces two outbound Horizon requests and holds the
serverless function for up to 1.5s + 2 × 3s ≈ 7.5 s of billable time.

**Impact.** Modest amplification of an unauthenticated request into upstream load
and cost, plus use of the deployment as an unwitting relay for traffic against
Horizon. The write limiter (5 per 10 minutes) bounds this per IP per instance,
and ZEN-12 and ZEN-17 both weaken that bound.

**Recommendation.** Retry only when the hash was seen recently, cap concurrent
in-flight anchor verifications per instance, and count a failed verification
against a tighter budget than a successful submission.

---

### ZEN-12 — Write endpoints accept cross-origin simple requests; the rate-limit key is header-derived (Low)

**Where.** `src/lib/api/validation.ts:216–235` (`readJsonBody`),
`src/lib/api/rate-limit.ts:124–137` (`clientKey`). No middleware exists
(`src/middleware.ts` is absent).

**What.** `readJsonBody` reads `request.text()` and parses it. It never inspects
`content-type`, and no handler checks `origin` or `referer`. A cross-site page
can therefore issue `POST /api/feedback` or `POST /api/onboard` as a CORS
*simple* request (`content-type: text/plain`, or an HTML form with
`enctype="text/plain"`) with no preflight. The attacker cannot read the response,
which does not matter — the write lands.

There are no cookies and no sessions anywhere in this application, so this is not
CSRF in the classic sense: nothing is authenticated, so nothing is confused. The
consequence is the rate limiter. `clientKey` buckets by the first hop of
`x-forwarded-for`, falling back to `x-real-ip` and `cf-connecting-ip` — all
request headers. On a platform that overwrites `x-forwarded-for` this is
correct; on any deployment where a proxy appends rather than replaces, the
leftmost value is attacker-supplied and the bucket is chosen by the attacker.

**Exploitation.** Embed the writes in a page with traffic and every visitor
contributes a submission from their own IP, spreading the load across as many
buckets as there are visitors. Or, off-Vercel, send a fresh `x-forwarded-for` per
request and never share a bucket at all.

**Impact.** Rate-limit evasion and unattributable junk rows in `feedback` and
`users`, which are the tables the growth metrics are computed from.

**Recommendation.** Require `content-type: application/json` on write routes,
which forces a preflight and blocks the simple-request path. Take the client IP
from the platform's trusted position (the rightmost untrusted hop, or Vercel's
`request.ip`) rather than the leftmost header value.

---

### ZEN-13 — CSP omits directives the WebAssembly constraint does not actually block (Low)

**Where.** `next.config.mjs:15–22`.

**What.** The policy shipped is a single directive:

```js
{ key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
```

The file's comment explains the omission of `script-src` — the Groth16 witness
needs `wasm-unsafe-eval` and Next injects inline bootstrap scripts — and that
reasoning is correct and worth keeping. It does not extend to the rest of the
policy. `base-uri`, `object-src`, `form-action`, `frame-src` and
`upgrade-insecure-requests` place no constraint on script execution or on
WebAssembly, and all are absent.

Also absent: `Cross-Origin-Opener-Policy`. The other baseline headers are
present and correct — HSTS with `includeSubDomains; preload`, `nosniff`,
`X-Frame-Options: DENY`, `strict-origin-when-cross-origin`, and a
`Permissions-Policy` that denies camera, microphone, geolocation and payment.
`poweredByHeader` is disabled.

**Impact.** Low on its own: these directives are defence in depth against an
injection this codebase has no known instance of (no `dangerouslySetInnerHTML`
anywhere; React escapes all rendered feedback content). They cost nothing and
their absence is not explained by the stated constraint.

**Recommendation.** Extend the policy to
`frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'`
now, and add `Cross-Origin-Opener-Policy: same-origin`. Treat a nonce pipeline
plus `script-src 'self' 'wasm-unsafe-eval' 'nonce-…'` as the separate,
larger piece of work it is.

---

### ZEN-21 — `.env.example` and `ARCHITECTURE.md` still claim the server holds no signing key (Low)

**Where.** `.env.example` (the `SPONSOR_SECRET` block versus the closing
"Deliberately absent" block) and `docs/ARCHITECTURE.md:15`.

**What.** The addition of the fee sponsor made two standing invariants false, and
neither document that asserts them was updated to match.

`.env.example` now documents `SPONSOR_SECRET` correctly — *"Stellar secret seed
(S…) of the account that pays fees … THIS ACCOUNT SPENDS REAL VALUE"* — and yet
its own closing section, twenty lines further down, still reads:

> *Deliberately absent: anything holding a Stellar secret key. … the server has
> no signing authority and no key to leak.*

The same file simultaneously defines a server-held Stellar secret seed and
declares that no such thing exists. `docs/ARCHITECTURE.md:15` carries the
matching claim in prose: *"There is no server-side wallet, no server-side
signing, and no backend indexer."* That was true at `e6368df` and is false at
`db6fd41`.

**Impact.** Low, but the class matters. An operator or auditor doing exactly what
this review's §6 asks — enumerating where signing keys live — reads "no key to
leak", concludes the deployment has no hot key to protect, and under-provisions
the custody and rotation the sponsor account actually needs. A security document
that contradicts itself is worse than one that says nothing, because it
discourages the reader from looking further.

**Recommendation.** Delete or rewrite the "Deliberately absent" block to describe
the sponsor key as the one server-held key, its blast radius, and its rotation
procedure. Correct `ARCHITECTURE.md:15` to "no server-side *user* signing; one
fee-payer key, scoped to bumping our own contracts (`src/lib/api/sponsor.ts`)".

---

### ZEN-06 — Wallet kit now derives the network; wallet-id persistence is still fixed to Freighter (Informational, Mitigated)

**Where.** `src/lib/stellar/kit.ts:11–21`, `:37–38`;
`src/components/app/wallet-provider.tsx:56–59`.

**What / Mitigated.** An earlier snapshot of `kit.ts` hardcoded
`network: Networks.TESTNET`, which would have handed a mainnet build a
testnet-initialised wallet kit while transactions were constructed for the
public network. At `db6fd41` this is fixed: the kit derives its network from the
shared config —

```ts
const KIT_NETWORK = activeNetwork === 'public' ? Networks.PUBLIC : Networks.TESTNET;
...
StellarWalletsKit.init({ network: KIT_NETWORK, ... });
```

— so `src/config/network.ts` is once again the single place the two network
vocabularies meet, as its docstring intends.

**Residual.** `connect()` still persists `walletId: FREIGHTER_ID`
unconditionally (`wallet-provider.tsx:56–59`), whatever the user selected in the
modal, so a session rehydrated from `localStorage` always re-selects Freighter.
Cosmetic — the address is still correct and the passphrase is still derived from
the profile — but it means a non-Freighter user is silently re-pointed at
Freighter on reload.

**Recommendation.** Persist the wallet id `authModal()` actually returns. Add a
test asserting `Networks.TESTNET`/`Networks.PUBLIC` appear nowhere outside
`src/config/network.ts` and `src/lib/stellar/kit.ts`, so the hardcoding cannot
silently return.

---

### ZEN-14 — Contract authorisation is never negatively tested (Informational)

**Where.** All five `contracts/*/src/test.rs`.

**What.** Every test in every contract begins with `env.mock_all_auths()`, which
makes `require_auth` unconditionally succeed. No test uses `mock_auths` with a
specific invoker, and no test asserts that an unauthorised caller is rejected.
`require_auth` is therefore present in the source and unexercised by the suite.

Two tests read as authorisation tests and are not. `rejects_unregistered_logger`
in `contracts/zentra-reputation/src/test.rs:37–50` exercises only the explicit
`logger != registered` equality check (`lib.rs:64`), because under
`mock_all_auths` the imposter's `logger.require_auth()` passes. The multisig's
`non_signer_cannot_propose` / `non_signer_cannot_approve`
(`contracts/zentra-multisig/src/test.rs:83–108`) are the same shape: they prove
the `NotASigner` membership check, while `proposer.require_auth()` /
`signer.require_auth()` are mocked to succeed. Those membership checks are the
right defences and the tests are real tests of them — but the `require_auth`
half of each pair is untested in all five contracts.

The Action Log's cross-contract test uses a `MockReputation` whose `bump`
performs no authorisation at all
(`contracts/zentra-action-log/src/test.rs:14–21`), so the auto-authorisation
path the production comment describes is not covered end to end either.

**Impact.** A future change that drops a `require_auth` line passes CI. The
finding is Informational because no such regression currently exists.

**Recommendation.** Add one negative test per state-changing function using
`mock_auths` scoped to a different address, asserting the invocation fails.
Integration-test `record` against the real `Reputation` contract rather than a
permissive mock.

---

### ZEN-15 — On-chain storage grows without bound and cannot be pruned (Informational)

**Where.** `zentra-action-log/src/lib.rs:104–109`,
`zentra-feedback/src/lib.rs:85–92`, `zentra-proof-registry/src/lib.rs:61–66`,
`zentra-multisig/src/lib.rs:103–112` (`save`).

**What.** Each write creates a new `Entry(index)` (or `Proposal(id)`) under
persistent storage and increments a monotonic counter. There is no delete, no
overwrite, no cap, and no administrative prune in any of the four entry-creating
contracts (reputation instead grows one `Score` key per distinct author, equally
unbounded). The counters
are `u64` and the feedback rating sum is `u64` accumulating values of at most 5,
so arithmetic overflow is not reachable in practice; `overflow-checks = true` is
set in every release profile, so an overflow would trap rather than wrap in any
case. The multisig goes further and turns its proposal-counter overflow into an
explicit `CounterOverflow` error rather than relying on the trap
(`zentra-multisig/src/lib.rs:176`), which is the better pattern.

Growth is paid for by the caller — the submitter funds the ledger entry and its
rent — so this is not an economic attack on the project. Its consequences are the
archival behaviour in ZEN-02 and the fact that content committed by a user is
permanent and unmoderatable (ZEN-10).

**Recommendation.** Document that entries are permanent and rent-bearing, and
decide before mainnet whether an operator needs any pruning or restoration
authority at all — with the understanding that granting it creates exactly the
kind of privileged, irreversible power that ZEN-01 is about.

---

### ZEN-16 — `x-request-id` is caller-controlled and echoed to logs and response headers (Informational)

**Where.** `src/lib/api/route.ts:114–118` (`resolveRequestId`), `:128–140`
(`withRequestId`).

**What.** An inbound `x-request-id` is trusted and echoed if it is non-empty and
at most 200 characters. It is written into every log line for the request and
returned as a response header. Log injection is not possible — every line goes
through `JSON.stringify` in `src/lib/api/logger.ts:46` — and response splitting
is not possible, because header values containing CR or LF do not survive the
HTTP parser. A caller can nonetheless choose the correlation id another caller's
lines are grouped under.

**Status: Accepted.** `docs/ARCHITECTURE.md` §9 states it: *"`x-request-id` is
caller-controlled. It is echoed as sent, capped at 200 characters — a correlation
aid, not an authenticated identifier."*

**Recommendation.** Restrict the accepted value to `[A-Za-z0-9._-]` so it cannot
be chosen to collide with or impersonate a generated UUID.

---

### ZEN-17 — Rate limiting is per instance (Informational)

**Where.** `src/lib/api/rate-limit.ts` (whole module).

**What.** Fixed windows in a `Map` on `globalThis`. With N concurrent Vercel
instances the effective ceiling is roughly `limit × N`, and scale-to-zero
discards every counter.

**Status: Accepted, and honestly documented in three places** — the module
header (*"Treat this as a spam and abuse speed bump, not a security control"*),
`docs/API.md` §5 and §10, and `docs/ARCHITECTURE.md` §8 and §9. The module is
also careful in its own right: `MAX_KEYS = 5000` with eviction (`:72–89`) means a
flood of unique IPs cannot grow the map without limit, and the raw header value
is never logged.

**Severity rationale.** This is Informational, not High. It protects a public
feedback form and a signup counter — no funds, no credentials, no personal-data
read. Its failure mode is spam, which is recoverable, and it is already
correctly characterised by the project. It is a Low-or-Informational control
and treating it as more would misdirect effort away from ZEN-01 through ZEN-05.

**Recommendation.** Move to a shared store (Redis/Upstash) when traffic
justifies it — and before it becomes the control protecting anything that
matters. Listed in §5 for that reason.

---

### ZEN-18 — `verifyAnchor` depends on caller-side validation for its SSRF safety (Informational)

**Where.** `src/lib/api/verify-anchor.ts:58`.

**What.** The Horizon URL is built by interpolation:

```ts
const response = await fetch(`${stellar.horizonUrl}/transactions/${txHash}`, {
```

`verifyAnchor` performs no validation of `txHash` itself.

**Status: Mitigated.** The only caller is `confirmAnchor` in
`src/app/api/feedback/route.ts:113`, which runs strictly after
`parseFeedbackInput` has enforced `/^[0-9a-f]{64}$/` and lower-cased the value
(`src/lib/api/validation.ts:46`, `:111–121`). A value reaching the template can
contain no `/`, `?`, `#`, `@` or `:`, so path traversal, query injection and host
substitution are all closed. `stellar.horizonUrl` is a compile-time constant from
`src/config/network.ts`, not an environment value an attacker could influence.
The 3-second `AbortController` timeout (`:26`, `:54–55`) and the `finally`-clause
`clearTimeout` (`:102–106`) bound the request properly.

**Recommendation.** Re-assert the hash shape inside `verifyAnchor` so the
function is safe independent of its caller. The module is otherwise a model of
how this check should be written — it resolves rather than throws for every
failure mode and keeps `unavailable` distinct from `not_found` so Horizon being
down is not read as evidence against the user.

---

### ZEN-19 — No dependency audit in CI; `snarkjs` is vendored outside the lockfile (Informational)

**Where.** `.github/workflows/ci.yml`; `package.json`; `public/zk/snarkjs.min.js`;
`.github/` contains only `workflows/`.

**What.** CI runs `cargo test` for all five contracts and, for the frontend,
typecheck, Vitest and a production build. There is no `cargo audit`, no
`bun audit`, no SCA step and no Dependabot or Renovate configuration. Dependency
versions are declared with `^` ranges and pinned by `bun.lock`, so builds are
reproducible but drift is never reported. The vendored snarkjs bundle described
in ZEN-05 is outside that mechanism entirely.

CI is otherwise well configured: `permissions: contents: read` at the workflow
level, no deploy step, no secrets in the workflow, and pinned major versions on
every action.

**Recommendation.** Add `cargo audit` and a JS advisory check to CI, and enable
Dependabot for cargo, npm and GitHub Actions.

---

### ZEN-22 — The multisig contract is an approval board, not account-level custody (Informational)

**Where.** `contracts/zentra-multisig/src/lib.rs:241–285` (`execute` and its
docstring).

**What.** The `zentra-multisig` contract is well-built as an N-of-M *approval
log* — the constructor rejects an empty signer set, a zero or oversized
threshold, and duplicate signers (`:126–148`); `approve` rejects a repeat
approval, which is the load-bearing check that keeps "N" meaningful (`:210–224`);
and `execute` uses check-effects-interactions ordering, flipping `executed`
before publishing so a proposal cannot be discharged twice (`:260–285`). None of
that is in question.

The security-relevant point is what `execute` does not do, stated plainly in its
own docstring: *"This contract moves no funds and makes no cross-contract call:
it decides that an action is authorized and publishes that decision as an
`executed` event. The caller … is responsible for acting on `kind` and
`payload`."* The contract is therefore advisory. Its guarantees hold only if an
off-chain consumer actually watches the `executed` stream, acts on nothing else,
and is idempotent on `id`. Nothing on-chain enforces that coupling.

**Why it matters for this review.** §5 item 3 asks for multisig on the deployer
and sponsor keys. This contract does not provide that. Account custody on
Stellar is enforced by signer weights and thresholds *on the account itself*; a
key whose only constraint is "a separate contract emitted an approval event" is
not constrained at all unless every path that uses the key is disciplined to
check first — which is an off-chain policy, not a cryptographic control. Reading
"we have a multisig contract" as "the deployer key is multisig" would be a
category error.

**Recommendation.** Use Stellar account-level multisig (signers + thresholds on
the deployer and sponsor accounts) for key custody. Keep this contract for what
it is good at — a transparent, on-chain approval trail — and document that it
authorises decisions, it does not hold keys.

---

## 4. Positive controls

Verified, not assumed. Each was read in the file named.

| Control | Where | What was verified |
| --- | --- | --- |
| **No user signing key server-side; the one server key cannot move user value** | `src/lib/stellar/*`, `src/app/api/**`, `src/lib/api/sponsor.ts` | No user secret key is ever server-side. Every user transaction is built unsigned (`buildPaymentXdr`, `buildRecordXdr`, `buildFeedbackXdr`, `buildAnchorXdr`), signed by the user's wallet extension, and submitted as signed XDR. The one server-held key is `SPONSOR_SECRET`, and a fee-bump changes *who pays the fee*, never *what the inner transaction does* — the user's signature authorises exactly what they signed. A server compromise leaks the sponsor's fee budget (ZEN-20), not any user's funds or authority. |
| **Fee sponsor: secret hygiene and fail-closed** | `src/lib/api/sponsor.ts:104–106`, `:187–237`; `src/app/api/sponsor/route.ts:86–92` | `SPONSOR_SECRET` is loaded per call and never memoised, so a rotation takes effect without a redeploy. Every `Keypair.fromSecret` sits inside a `try`/`catch` that discards the thrown value, so a malformed seed cannot ride a stack into a log. An unset or unparseable secret makes the endpoint report itself unconfigured and refuse with a 503 — there is no environment value that turns sponsorship on by accident. The signed bump is returned to the client to broadcast; the server never broadcasts and so is never the ambiguous "did the fee move" path. Neither the secret nor the submitted XDR is ever logged. |
| **Fee sponsor: allowlist closes the theft-shaped drain** | `src/lib/api/sponsor.ts:88–93`, `:289–303` | The set of sponsorable targets is built from `@/config/contract` (so a redeploy cannot leave a stale allowlist) and every root operation must be an `invokeHostFunction` invoking one of the four deployed contracts. A payment, account merge, change-trust, create-account, Wasm upload or invocation of an unrelated contract is refused. This is what stops the sponsor paying for a stranger's value transfer; the residual usage-shaped drain is ZEN-20. |
| **N-of-M multisig contract built correctly** | `contracts/zentra-multisig/src/lib.rs` | Constructor rejects empty signers, zero/oversized threshold and duplicate signers (`:126–148`); `approve` rejects a repeat approval so one key cannot satisfy the threshold alone (`:210–224`); `execute` writes `executed = true` before publishing, so re-entry bounces off `AlreadyExecuted` (`:260–285`); the proposal counter uses `checked_add` with an explicit `CounterOverflow` error. Its scope limit is documented, not a defect (ZEN-22). |
| **Network is a single, fail-safe switch** | `src/config/network.ts`, `src/lib/stellar/kit.ts:11–21`, `src/config/contract.ts` | One module resolves the chain from `NEXT_PUBLIC_STELLAR_NETWORK`; an unrecognised or absent value resolves to testnet, so a typo never points the app at real funds. The wallet kit now derives its network from that module too (ZEN-06 mitigated), and mainnet contract ids are deliberately left empty with `contractsConfigured` reporting the state rather than shipping invented ids. |
| **Health probe detects a wrong-network deploy** | `src/app/api/health/route.ts:87–103` | The readiness probe asks Soroban RPC for its passphrase and reports `error` when it does not match the configured network — catching the failure a database-only probe cannot see, a build serving mainnet traffic from a testnet configuration or vice versa. The body still exposes no connection strings, versions or region names. |
| **Fail-closed admin gate** | `src/lib/api/auth.ts:57–61` | Configuration is checked before credentials, so no header value opens a deployment whose `ADMIN_TOKEN` is unset; blank and whitespace-only values count as absent (`:46`). The failure is a 503, not a 401, so an operator is not sent looking in the wrong place. |
| **Fully parameterised SQL** | Every `db\`` in `src/app/api/**` | All eight query sites use the Neon tagged template with interpolated values as bound parameters. `grep` for string-built SQL, `.unsafe(`, `.raw(` and concatenation into a query returns nothing outside a prose reference in `src/lib/pitch.ts`. There is no SQL-injection surface. |
| **Generic 500s that never echo driver messages** | `src/lib/api/errors.ts:115–128` | `toErrorBody` collapses anything that is not an `ApiError` to a fixed `{code: "internal", message: "Internal server error."}`. Every route wraps its database failures in `storageUnavailable`, logging the real error server-side and returning a 503 with a fixed string. `/api/health` applies the same rule from the other side, returning the literal `unavailable` and nothing about which layer broke. |
| **Log hygiene** | `src/lib/api/logger.ts:76–101`, `src/lib/db.ts:35–38` | `redact` masks any top-level field whose key matches `secret\|token\|password\|key\|authorization\|cookie\|database_url\|connection`. `normalise` reduces an `Error` to `{name, message}` in production, dropping the stack and any driver-specific side fields such as Postgres `detail` — which is what would otherwise carry a submitted email address on a unique violation. `sql()` never quotes `DATABASE_URL` in its own error messages. |
| **Personal data kept out of logs by design** | `src/app/api/onboard/route.ts:75–79`, `src/app/api/admin/users/route.ts:61` | The signup log line carries `requestId`, `wallet` and `rating` and deliberately omits name and email, with the reason written down. The CSV export logs only the row count, never row contents. |
| **CSV-injection escaping** | `src/app/api/admin/users/route.ts:147–151` | `escapeField` prefixes a single quote to any field beginning `=`, `+`, `-` or `@` *before* the RFC 4180 quoting decision, so the guard lands inside the quotes. The threat model is written out in the docstring and is correct: the payload becomes code on the operator's machine, not in the database. |
| **A real trust boundary** | `src/lib/api/validation.ts` | Every request body is `unknown` until it passes through `parseFeedbackInput` / `parseUserInput`, both of which rebuild the value field by field from an explicit list — so no caller-supplied extra key can reach an `INSERT`. Mass assignment is structurally impossible. `readJsonBody` checks `content-length` before touching the stream and re-measures the decoded bytes in case the header lied (`:216–224`). |
| **Validation enforced twice, independently** | `src/lib/api/validation.ts` and `db/schema.sql` | Every rule the API enforces is also a named CHECK constraint in Postgres — rating range, comment and name lengths, the `G[A-Z2-7]{55}` wallet shape, the lowercase-hex `tx_hash` shape, and the invariant `NOT on_chain OR tx_hash IS NOT NULL`. A bug in the first layer cannot corrupt the table. `db/migrations/001_harden_feedback.sql` exists specifically because `CREATE TABLE IF NOT EXISTS` cannot retrofit constraints onto an existing table. |
| **On-chain claims resolved, not trusted** | `src/lib/api/verify-anchor.ts:53–98` | A client-supplied `txHash` is checked against Horizon for existence, for `successful === true` (a transaction can be in a ledger and have failed), and for `source_account` equal to the claiming wallet — without which any public hash could be replayed as one's own. Horizon being unreachable yields `unavailable`, which is deliberately not treated as evidence against the user. |
| **Moderation withholds rather than rejects** | `src/lib/api/moderation.ts`, `src/app/api/feedback/route.ts:82–87` | A flagged comment is stored and acknowledged normally and simply never served, so an abuser gets no signal about which word tripped the filter and no fast retry loop. Hidden rows are excluded from the aggregate as well as the list, so a withheld comment cannot drag the average. The word list's scope and its deliberate non-exhaustiveness are documented at the definition. |
| **Reversible moderation, no destructive delete** | `src/app/api/admin/feedback/route.ts` | `PATCH` flips a boolean and returns `RETURNING id` so "no such row" is distinguishable from "flag unchanged"; a 404 is thrown outside the storage `try` so it cannot be swallowed by the 503 handler. `id` is rejected above `Number.isSafeInteger` rather than silently rounding onto another row, and `hidden` must be a real boolean, not merely truthy. |
| **No cookies, no sessions, no CSRF surface** | Whole codebase | Nothing sets or reads a cookie; there is no authentication state a cross-site request could ride on. The residual cross-origin concern is ZEN-12, which is about rate-limit attribution, not privilege. |
| **No XSS sinks** | Whole codebase | `dangerouslySetInnerHTML` appears nowhere. Feedback comments and wallet addresses are rendered as React children and escaped. |
| **Overflow checks on in release builds** | All five `Cargo.toml` | Every contract sets `overflow-checks = true` alongside `panic = "abort"`, `lto = true` and `strip = "symbols"`, so integer overflow traps rather than wrapping silently. |
| **Contract input validation with typed errors** | `zentra-action-log:79–85`, `zentra-feedback:63–73` | Empty and over-long messages and out-of-range ratings return `contracterror` values, not panics, and the state change is not applied — `rejects_empty_message` asserts `get_count()` is still 0 afterwards. |
| **Read bounds on every list function** | `action-log`, `feedback`, `proof-registry` | `get_recent` caps `limit` at `MAX_RECENT = 20` regardless of what the caller asks for, so a read cannot be made arbitrarily expensive. |
| **No secret has ever been committed** | `git ls-files`, `git log --all -- '*.env*'` | The only tracked env file is `.env.example`, and every historical revision of it contains the placeholder `postgresql://user:password@host.neon.tech/dbname?sslmode=require`. `.env.local` exists on disk and is untracked, covered by the `.env*.local` rule in `.gitignore`. |
| **Least-privilege CI** | `.github/workflows/ci.yml` | `permissions: contents: read` at workflow level, no deploy step, no secrets referenced, pinned major versions on every action. |
| **Limitations written down rather than papered over** | `docs/ARCHITECTURE.md` §8–§9, `docs/API.md` §5, §10 | The per-instance limiter, the unauthenticated endpoints, the self-reported wallet, the missing `script-src`, the wallet-squatting consequence of the unique index, and "testnet only, unaudited" are all documented before anyone had to find them. Several findings above are refinements of limitations the project had already stated. |

---

## 5. Pre-mainnet checklist

Ordered. Nothing below item 1 substitutes for item 1.

| # | Requirement | Must be true |
| --- | --- | --- |
| 1 | **Professional third-party audit** | An independent firm has reviewed all five contracts and the circuit, every Critical/High/Medium is fixed or formally accepted in writing, and the report is published. This review does not count and was not intended to. |
| 2 | **Verifying-key management** | The verifying key deployed on-chain provably corresponds to the circuit build shipped in `public/zk/`. The trusted-setup ceremony transcript is published and independently verifiable. Every artefact in `public/zk/` has a recorded digest, checked in CI and by the client at load (ZEN-05). A key-rotation procedure exists and has been rehearsed. |
| 3 | **Key custody and multisig on the deployer and the sponsor** | The deployer/admin account and the fee-sponsor account (`SPONSOR_SECRET`) are Stellar **account-level** multisig accounts — signer weights and thresholds on the account itself, at least 2-of-3, signers on separate hardware wallets held by separate people. No single laptop-resident CLI identity (`contracts/deploy.sh` defaults to one) holds admin authority, and the sponsor is a dedicated account holding only its fee float, never the deployer or an account holding anything else (`.env.example` says as much). The `zentra-multisig` contract is an on-chain approval board and is **not** a substitute for this (ZEN-22). Signer lists, thresholds, and a rehearsed rotation procedure for both accounts are documented. |
| 4 | **Contract upgrade and pause strategy** | A written decision, per contract, on whether it is upgradeable. If yes: who authorises an upgrade, behind what timelock, with what event emitted. If no: that immutability is stated publicly and the ZEN-01 recovery gap is closed some other way. A pause switch exists for anything that can lose value, or it is documented that none can. |
| 5 | **Incident response contact and process** | A published security contact (`SECURITY.md`, a monitored address, and a `security.txt`), a stated disclosure window and safe-harbour statement, a named on-call owner, and a rehearsed runbook covering key compromise, contract brick and database exposure. |
| 6 | **Rate limiting backed by a shared store, plus a sponsor spend budget** | Redis or Upstash behind every public write route and every admin route, so the ceiling is global rather than per instance (ZEN-04, ZEN-17). Client IP taken from the platform's trusted position, not the leftmost `x-forwarded-for` (ZEN-12). The fee-sponsor endpoint additionally enforces a per-inner-transaction-source lumen budget in that shared store, so no single actor can drain the float regardless of IP (ZEN-20). |
| 7 | **Personal-data retention and deletion policy** | A written retention period, a working delete-my-data path, a lawful basis and consent record for the email addresses in `users`, and a named data controller. `docs/users/README.md` already lists "No deletion path" under Known gaps — that gap must close before mainnet, and ZEN-03 must be fixed so exports cannot reach version control. |
| 8 | **Monitoring and alerting** | Alerts on: `admin.denied` above a threshold; any 5xx rate change; `/api/health` degradation and its new network-mismatch signal; remaining TTL on each contract instance and on recent entries (ZEN-02); anomalous `record`/`anchor` volume; the sponsor account's balance and the `sponsor.granted` rate (ZEN-20); and Horizon/RPC error rates. Log retention long enough to investigate an incident found late. |
| 9 | **Mainnet configuration audit** | `NEXT_PUBLIC_STELLAR_NETWORK=public` produces a build in which every component — including `src/lib/stellar/kit.ts` (ZEN-06) — agrees on the network. Verified on a staging deployment against mainnet before any real value moves. |
| 10 | **Contract test suite covers authorisation negatively** | At least one `mock_auths`-scoped rejection test per state-changing function (ZEN-14), and an integration test of `record` against the real `Reputation` contract. |
| 11 | **Dependency and supply-chain hygiene** | `cargo audit` and a JS advisory check in CI, Dependabot enabled, and every runtime artefact governed by the lockfile or by a recorded digest (ZEN-19). |

---

## 6. Threat model

### Framing

This section reuses the boundary the project has already published rather than
inventing a competing one. `content/docs/start-here/what-zentra-is-not.mdx`
states it: Zentra is *"a proof-of-compliance and settlement layer. It is **not**
an identity system, an oracle, a policy author, a key manager, or a full
compliance engine."* `README.md` §Project status states the deployment posture:
*"a testnet MVP … It is not audited and not on mainnet; treat it as a working
proof-of-concept."*

### Assets

| Asset | Where it lives | Why an attacker wants it |
| --- | --- | --- |
| The onboarding registry — names, emails, wallets | `users` in Neon; `GET /api/admin/users` | The only personal data in the system. Directly usable for phishing that targets Stellar holders, and the population is pre-qualified as crypto-active. |
| `ADMIN_TOKEN` | Vercel project settings; operator shells | Single key to the registry above and to moderation. No rotation, no per-person attribution (ZEN-04). |
| `DATABASE_URL` | Vercel project settings | Full read/write on both tables. |
| `SPONSOR_SECRET` — the fee-payer key | Vercel project settings; loaded per request in `src/lib/api/sponsor.ts` | The one server-held Stellar key. A leak lets the holder sign fee-bumps until the float is gone; scripted valid calls drain it even without a leak (ZEN-20). Cannot move user funds — a bump changes who pays, not what happens. |
| Deployer / contract-admin key | One CLI identity per `contracts/deploy.sh` | Can permanently disable the Action Log today (ZEN-01), and would hold upgrade authority on any future upgradeable contract. |
| Integrity of the Action Log and its history | Stellar testnet | The product's central claim is a verifiable record. Bricking it or forcing its redeployment destroys continuity, which is the whole value. |
| ZK artefacts in `public/zk/` | Vercel static assets | The witness contains the private policy and salts. A tampered prover exfiltrates exactly what the browser-proving design exists to protect (ZEN-05). |
| Users' Stellar keys | The user's own wallet extension only | Out of the system's reach by design — no server-side signing, no key material in any environment variable. |
| Reputation of the public feeds | `/metrics`, `/playground`, `/board` | Cheap to pollute (ZEN-07, ZEN-09, ZEN-12); the numbers are used in the project's own reporting. |

### Actors

| Actor | Capability assumed | Findings that concern them |
| --- | --- | --- |
| Anonymous internet user | Unlimited HTTP requests, arbitrary bodies and headers, own Stellar account and funds | ZEN-04, ZEN-08, ZEN-09, ZEN-10, ZEN-11, ZEN-12, ZEN-20 |
| Spammer / abuser | The above at volume, with IP rotation | ZEN-10, ZEN-12, ZEN-17 |
| Curious or careless operator | Holds `ADMIN_TOKEN`, has commit access | ZEN-03, ZEN-04 |
| Compromised operator or deploy pipeline | Write access to `public/`, to environment variables (including `SPONSOR_SECRET`), or to the admin key | ZEN-01, ZEN-05, ZEN-19, ZEN-20 |
| Contract admin (honest but mistaken) | Can call `set_logger` | ZEN-01 |
| Passive ledger observer | Reads all contract state and events | ZEN-07, ZEN-10, ZEN-15 |
| Malicious dependency | Executes in the build or in the browser | ZEN-05, ZEN-13, ZEN-19 |
| Time | No adversary required | ZEN-02 |

### Explicitly out of scope of the design

Restating the published boundary, with the security consequence of each spelled
out. These are not gaps; they are the shape of the system.

| Not claimed | Security consequence |
| --- | --- |
| **Not an identity system** | Zentra verifies that an action obeyed a policy, not who the agent is. Authorisation is `require_auth` on a Stellar account and nothing more. Any binding between an account and a person — including the `wallet` field on feedback and signup — is unproven unless an anchored transaction backs it (ZEN-08, ZEN-09). |
| **Not an oracle** | Statements are proved about values the caller supplies. Nothing attests that those values reflect anything off-chain. Garbage in, provably-compliant garbage out. |
| **Not a policy author** | Zentra makes a policy enforceable in zero knowledge; it does not judge whether the policy is sensible. A policy that permits an unwise payment produces a valid proof of that unwise payment. |
| **Not a key manager** | *User* signing keys and their custody belong to the user; Zentra never sees or holds one, so no finding above risks a user's key. The project does hold two keys of its own — the deployer/admin key and the fee-sponsor key (`SPONSOR_SECRET`) — and those are exactly what ZEN-01, ZEN-20 and §5 item 3 are about. Holding a fee-payer is not managing a user's key: a bump pays for a transaction, it cannot author or alter one. |
| **Not a full compliance engine** | Only the specific provable rules a policy encodes are enforced. Open-ended regulatory judgment is outside the primitive. |
| **Not audited, not on mainnet** | Every contract, endpoint and proof in this repository targets testnet. No finding above has been triaged against real value at risk, because there is none yet. That changes the day item 1 of §5 is satisfied and not before. |
