# Zentra — Mainnet Launch Runbook

## 1. Status

**Zentra runs on Stellar testnet only. Nothing in this repository is deployed to
the public network, and no mainnet launch has been scheduled.**

This document is preparation, not a record. It exists so that if and when a
mainnet deployment happens, it is a checklist someone follows rather than a
sequence someone improvises at 2am. Every contract id, ledger number and URL in
the repository today points at testnet; every command below is written for a
network that has not yet been touched.

Read this alongside:

| Document | What it gives you |
| --- | --- |
| `docs/ARCHITECTURE.md` | What the three tiers are and how they talk |
| `docs/API.md` | The seven HTTP handlers and their contracts |
| `docs/SECURITY-REVIEW.md` | The internal review — **not** an audit (§2) |
| `SECURITY.md` | How vulnerabilities are reported |
| `contracts/deploy.sh` | The real testnet deploy this runbook mirrors |

Two properties make mainnet different from every deploy done so far, and both
are load-bearing for the rest of this document:

1. **There is no friendbot.** Lumens on the public network are bought, not
   requested. Funding is a prerequisite, not a step.
2. **Nothing is undoable.** A deployed contract stays deployed. A submitted
   transaction stays submitted. §9 is honest about how little of this is
   reversible, and that asymmetry is the entire reason §2 exists.

---

## 2. Pre-flight gates

Every gate must be **true**, not "mostly true" or "planned". If one is not, the
launch does not start. There is no partial launch — §9 explains why.

| # | Gate | Evidence that it is met |
| --- | --- | --- |
| 1 | **Independent security audit complete**, findings triaged, criticals fixed | A written report from a party with no commit access to this repo |
| 2 | **All tests green on the commit being deployed** | A passing CI run on that exact SHA |
| 3 | **Deployer key in custody** | §3 satisfied — a named holder, a named storage mechanism |
| 4 | **Mainnet account funded** | §4 satisfied — balance confirmed on Horizon |
| 5 | **Rollback plan decided and written down** | §9 read and agreed by whoever will be on call |
| 6 | **Database provisioned and migrated** | §7 satisfied against the production database |
| 7 | **Incident contact named** | A person, reachable, who knows they are it |

### 2.1 On the audit gate

`docs/SECURITY-REVIEW.md` is an **internal** review. It was written by the same
people who wrote the code, which is exactly the population least able to see its
blind spots. It is useful — it catches the things a careful second read catches —
but it does not discharge gate 1 and must never be cited as though it does.

An independent audit means a party outside this project, paid or otherwise
committed to finding problems, producing a report you did not write. Until that
report exists, gate 1 is open.

The contracts are small, which shortens an audit but does not remove the need
for one. The highest-value targets are the cross-contract authorization path
(`Reputation::bump` trusting `DataKey::Logger`) and the admin-gated
`Reputation::set_logger`, since the admin address is set once at construction
and there is no code to change it afterwards.

### 2.2 Running the test gate

```bash
# Contracts — the four in CI
cargo test --manifest-path contracts/zentra-reputation/Cargo.toml
cargo test --manifest-path contracts/zentra-action-log/Cargo.toml
cargo test --manifest-path contracts/zentra-feedback/Cargo.toml
cargo test --manifest-path contracts/zentra-proof-registry/Cargo.toml

# Frontend
bun install
bun run types:check
bun run test
bun run build
```

These are the same steps `.github/workflows/ci.yml` runs. Run them locally on
the release commit anyway — CI proves the tree builds, running it yourself
proves you are looking at the tree you think you are.

> `contracts/zentra-multisig` exists in the tree but is **not** in CI, **not** in
> `src/config/contract.ts`, and **not** deployed anywhere. It is out of scope for
> this runbook. If it is ever to ship, it needs its own CI job and its own row in
> §11.

---

## 3. Key custody

The mainnet deployer account is the highest-value secret this project has. It
constructs the reputation contract with an admin address, and that admin is the
only account that can ever call `set_logger`. There is no rotation function and
no upgrade path in the contracts as written (§11).

### 3.1 Rules

1. **The deploy key is not an operational key.** Nothing that runs on a schedule,
   nothing in a CI job, and nothing a developer uses day to day may hold it. It
   signs a deployment and then goes back in the safe. `ADMIN_TOKEN`, the Neon
   credentials and any future service key are separate secrets with separate
   lifetimes.
2. **The admin address should not be the deploy key either.** Deploying is a
   one-off; being admin is forever. Point `ADMIN` at an account under
   multi-party or hardware control and let the deployer be a low-privilege
   account that only pays fees. See §3.3 for the operational consequence of
   splitting them, because `contracts/deploy.sh` assumes they are the same.
3. **No secret ever enters the repository.** `.gitignore` covers `.env*.local`;
   that is a safety net, not a policy. The policy is that secrets live in Vercel
   project settings, a password manager, or a hardware device — never in a file
   under version control.
4. **No secret ever enters a command line.** `argv` is visible to every process
   on the machine via the process table, and your shell writes it to history.
   This is wrong:

   ```bash
   # NEVER. Lands in ~/.bash_history and in `ps aux` output.
   stellar keys add zentra-mainnet-deployer --secret-key SB...
   ```

   Enter it at a prompt, or pipe it from a secrets manager on stdin:

   ```bash
   # Prompts for the secret; nothing is echoed and nothing reaches argv.
   stellar keys add zentra-mainnet-deployer
   ```

   Confirm the exact flags against your installed CLI (`stellar keys add --help`)
   before running this for real — the flag surface has changed between releases.
5. **No secret ever enters a CI log.** GitHub Actions masks registered secrets in
   output, but only the exact string. A base64 of it, a fragment of it, or an
   error message that quotes it are all unmasked. The safe rule is that CI never
   holds a signing key at all: `.github/workflows/ci.yml` today holds none, and
   mainnet deployment must not be the reason that changes. Deploy from a
   workstation, by hand, deliberately.

### 3.2 Custody options

| Option | Strength | Cost |
| --- | --- | --- |
| Hardware wallet (Ledger) holding the admin account | Key never exists in software | The `stellar` CLI path may not support it directly; verify before relying on it, and plan to sign built XDR externally if not |
| Stellar multisig — raise the account's thresholds and add signers | No single person can act alone | Every admin action becomes a coordination exercise |
| `contracts/zentra-multisig` as the admin address | N-of-M in a contract we control | Unaudited, uncovered by CI, and not deployed — gate 1 would have to cover it too |
| Secrets manager, single key | Simple, auditable access log | One compromised operator account is the whole loss |

This runbook does not choose for you. §11 records that the choice is open.

### 3.3 Consequence of splitting deployer from admin

`contracts/deploy.sh` defaults `ADMIN` to the deployer's own address:

```bash
ADMIN="${ADMIN:-$(stellar keys address "$SOURCE")}"
```

and then calls `set_logger` sourced from `$SOURCE`:

```bash
stellar contract invoke --id "$REPUTATION" \
  --source "$SOURCE" --network "$NETWORK" -- set_logger --logger "$ACTION_LOG"
```

`Reputation::set_logger` calls `admin.require_auth()`. So if you override
`ADMIN` with a different account, **that invoke will fail** — the script signs
with the deployer, and the contract demands the admin. This is correct behaviour
by the contract and a gap in the script.

If deployer and admin differ on mainnet, run the script's deploy steps and then
perform `set_logger` as a separate, admin-signed step (§5, step 5). Do not
"fix" it by making them the same account to keep the script happy.

---

## 4. Funding

There is no friendbot on the public network — `src/config/network.ts` encodes
this (`friendbotUrl: null` on the `public` profile) and `stellar.hasFriendbot`
is the flag to check before offering to fund anything in the UI.

### 4.1 What needs funding

| Cost | Driver | Notes |
| --- | --- | --- |
| Account minimum balance | Base reserve × (2 + subentries) | The account cannot spend below this; it is locked, not spent |
| Contract deployment | Upload of each WASM + instantiation, four times | Dominated by WASM size; `opt-level = "z"` and `lto = true` are already set in every `Cargo.toml` |
| Per-transaction fee | Inclusion fee + resource fee | Trivial per transaction, non-trivial in aggregate over a live product |
| Rent / TTL extension | Ongoing, forever | See §4.3 — this is the recurring one people forget |

### 4.2 These are estimates, not quotes

**Do not budget from this table.** Every figure below is a rough order of
magnitude to be replaced with a measured number before gate 4 is closed. Stellar
network parameters (base reserve, base fee, rent rates) are set by validator
consensus and change; XLM has a price and this document does not know it.

| Item | Rough order of magnitude | How to replace the guess with a fact |
| --- | --- | --- |
| Bare account reserve | ~1 XLM | Read `base_reserve` from `GET https://horizon.stellar.org/ledgers?order=desc&limit=1` |
| Deploying one contract | Single-digit XLM | Deploy to testnet first and read the actual `resourceFee` off the transaction |
| One `record` / `submit` / `anchor` call | Fractions of an XLM | Same — simulate on testnet, read the fee |
| Annual TTL extension, all contracts | Unknown until measured | Extend on testnet and measure (§4.3) |

The honest procedure is: deploy the identical WASM to testnet from a clean
account, record what every operation actually cost, then fund mainnet with that
number plus a wide margin. Resource pricing differs between networks, so treat
the testnet figure as a shape, not a total.

### 4.3 Rent and TTL are recurring, not one-off

Soroban storage expires. Each contract sets its own extension windows:

| Contract | Instance window | Entry window |
| --- | --- | --- |
| `zentra-reputation` | 30 days | 30 days (scores) |
| `zentra-action-log` | 30 days | 90 days (entries) |
| `zentra-feedback` | 30 days | 90 days (entries) |
| `zentra-proof-registry` | 30 days | 90 days (entries) |

Every write self-extends, so a busy contract pays its own rent. A **quiet**
contract does not: 30 days without a single write and the instance can be
archived, at which point reads fail until it is restored. A product that is live
but unused is exactly the failure case. Budget for extension as a standing cost
and see §10.4 for the operational task.

### 4.4 Confirming the account is funded

```bash
# Replace with the real deployer address.
DEPLOYER=$(stellar keys address zentra-mainnet-deployer)
curl -sS "https://horizon.stellar.org/accounts/$DEPLOYER" \
  | jq '{id, balances}'
```

A `404` means the account does not exist yet — on mainnet an account is created
by being sent lumens, and nothing else.

---

## 5. Contract deployment

### 5.1 Dependency order

Deploy order is forced by the constructors. Verified against the sources:

| Order | Contract | Constructor | Depends on |
| --- | --- | --- | --- |
| 1 | `zentra-reputation` | `__constructor(env, admin: Address)` | Nothing |
| 2 | `zentra-action-log` | `__constructor(env, reputation: Address)` | The reputation contract id from step 1 |
| — | `zentra-feedback` | none | Nothing — deploy any time |
| — | `zentra-proof-registry` | none | Nothing — deploy any time |

**Reputation before action-log is correct.** `ActionLog::__constructor` takes the
reputation address and stores it under `DataKey::Reputation`, so the reputation
contract must already exist to have an id to pass. `zentra-feedback` and
`zentra-proof-registry` declare no `__constructor` at all and are independent of
both; they are deployed in the same session purely for convenience.

There is a second ordering constraint after deployment: `Reputation::set_logger`
must be called with the action-log's address before any `record` call can
succeed. Until it is, `bump` returns `Error::LoggerNotSet` and every `record`
fails.

### 5.2 Register the network

The `stellar` CLI ships with `testnet` preconfigured. Register the public
network explicitly rather than trusting an alias to mean what you assume:

```bash
stellar network add mainnet \
  --rpc-url https://mainnet.sorobanrpc.com \
  --network-passphrase "Public Global Stellar Network ; September 2015"

stellar network ls
```

The RPC URL matches the `public` profile in `src/config/network.ts`. If you use
a different provider, change it in both places — the CLI and `network.ts` must
agree on which chain they mean.

### 5.3 Build

```bash
cd contracts
( cd zentra-reputation     && stellar contract build )
( cd zentra-action-log     && stellar contract build )
( cd zentra-feedback       && stellar contract build )
( cd zentra-proof-registry && stellar contract build )
```

Record the hash of every artifact before it leaves your machine. This is what
lets anyone later confirm that the bytes on chain are the bytes in this repo:

```bash
sha256sum \
  zentra-reputation/target/wasm32v1-none/release/zentra_reputation.wasm \
  zentra-action-log/target/wasm32v1-none/release/zentra_action_log.wasm \
  zentra-feedback/target/wasm32v1-none/release/zentra_feedback.wasm \
  zentra-proof-registry/target/wasm32v1-none/release/zentra_proof_registry.wasm
```

### 5.4 Deploy reputation and action-log

`contracts/deploy.sh` already parameterises the network — `NETWORK="${NETWORK:-testnet}"`
— so no separate mainnet script is needed **when the deployer is also the admin**:

```bash
NETWORK=mainnet SOURCE=zentra-mainnet-deployer ./contracts/deploy.sh
```

When the admin is a different account (the §3.2 recommendation), run the steps
by hand so the `set_logger` call can be signed by the right account:

```bash
cd contracts

NETWORK=mainnet
SOURCE=zentra-mainnet-deployer
ADMIN=G...                      # the custody account, NOT the deployer

# 1. Reputation — admin is set once here and never again.
REPUTATION=$(stellar contract deploy \
  --wasm zentra-reputation/target/wasm32v1-none/release/zentra_reputation.wasm \
  --source "$SOURCE" --network "$NETWORK" -- --admin "$ADMIN")
echo "reputation = $REPUTATION"

# 2. Action log — takes the id from step 1.
ACTION_LOG=$(stellar contract deploy \
  --wasm zentra-action-log/target/wasm32v1-none/release/zentra_action_log.wasm \
  --source "$SOURCE" --network "$NETWORK" -- --reputation "$REPUTATION")
echo "action_log = $ACTION_LOG"
```

Stop here and check the `ADMIN` value that actually went on chain. It cannot be
changed later:

```bash
stellar contract invoke --id "$REPUTATION" \
  --source "$SOURCE" --network "$NETWORK" -- reputation 2>/dev/null || true
stellar contract invoke --id "$ACTION_LOG" \
  --source "$SOURCE" --network "$NETWORK" -- reputation
```

The second call must print the id from step 1. If it does not, the action log is
wired to the wrong contract and must be redeployed — the wiring is constructor-only.

### 5.5 Deploy feedback and proof-registry

No constructor arguments; note the bare `--` with nothing after it.

```bash
# 3. Feedback.
FEEDBACK=$(stellar contract deploy \
  --wasm zentra-feedback/target/wasm32v1-none/release/zentra_feedback.wasm \
  --source "$SOURCE" --network "$NETWORK")
echo "feedback = $FEEDBACK"

# 4. Proof registry.
PROOF_REGISTRY=$(stellar contract deploy \
  --wasm zentra-proof-registry/target/wasm32v1-none/release/zentra_proof_registry.wasm \
  --source "$SOURCE" --network "$NETWORK")
echo "proof_registry = $PROOF_REGISTRY"
```

### 5.6 Authorize the logger

This is the step that must be signed by `ADMIN`, not by the deployer.

```bash
# 5. Sourced from the ADMIN account. Fails with the deployer if they differ.
stellar contract invoke --id "$REPUTATION" \
  --source zentra-mainnet-admin --network "$NETWORK" \
  -- set_logger --logger "$ACTION_LOG"
```

If the admin is a hardware or multisig account the CLI cannot sign for, build
the transaction and sign it out of band. Do not work around it by reassigning
admin — you cannot.

### 5.7 Record the ids

Write these down before closing the terminal. There is no way to enumerate "the
contracts I deployed" afterwards other than reading your own history.

| Field | Value | Where it goes |
| --- | --- | --- |
| `reputationId` | `C…` | `src/config/contract.ts` |
| `contractId` (action log) | `C…` | `src/config/contract.ts` |
| `feedbackId` | `C…` | `src/config/contract.ts` |
| `proofRegistryId` | `C…` | `src/config/contract.ts` |
| `deployLedger` | ledger of the first deploy tx | `src/config/contract.ts` — the floor for event history |
| `readSource` | a funded **mainnet** account | `src/config/contract.ts` — simulation source for read-only calls |
| Deploy tx hashes | 4 hashes | This runbook's launch log |
| WASM sha256 | 4 hashes (§5.3) | This runbook's launch log |

`readSource` deserves a note: it is used only to *simulate* read-only calls, which
never sign or submit. Any existing funded mainnet account works, and the testnet
value currently in `contract.ts` will not — it does not exist on the public network.

---

## 6. Configuration cutover

### 6.1 The one switch

`src/config/network.ts` is the only module that knows which chain the app talks
to. `NEXT_PUBLIC_STELLAR_NETWORK` selects the profile:

| Value | Profile | Notes |
| --- | --- | --- |
| unset | `testnet` | The fail-safe default |
| `testnet` | `testnet` | |
| `public`, `mainnet`, `pubnet` | `public` | All three accepted; `public` is canonical |
| anything else | `testnet` | `resolveNetwork` never throws — a typo points at testnet, not at real funds |

`src/config/stellar.ts` derives every endpoint, passphrase and stellar.expert
link from that profile, so switching the variable moves Horizon, Soroban RPC,
the network passphrase, friendbot availability and all explorer URLs together.

### 6.2 What the switch does not cover

Two modules still name testnet directly and must be changed in code before a
mainnet build is correct:

| File | What is hardcoded | Required change |
| --- | --- | --- |
| `src/config/contract.ts` | Four testnet contract ids, `deployLedger`, a testnet `readSource` | No network awareness at all. It needs the mainnet ids from §5.7, selected the same way `network.ts` selects a profile |
| `src/config/protocol.ts` | `network: 'testnet'`, `rpcUrl`, `networkPassphrase`, the `EXPLORER` constant, the ZentraVerifier `contractId` | Derive from `activeProfile` instead of restating it |

Treat these as a code change reviewed and merged **before** the environment
variable is touched, not as part of the cutover. Flipping the variable with
testnet contract ids still compiled in produces an app that talks to the public
network and asks it for contracts that do not exist there.

### 6.3 Environment variables

| Variable | Mainnet value | Scope | Inlined at build? |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_STELLAR_NETWORK` | `public` | Production | **Yes** |
| `NEXT_PUBLIC_SITE_URL` | the production origin | Production | **Yes** |
| `DATABASE_URL` | production Neon connection string | Production | No — read at request time |
| `ADMIN_TOKEN` | a fresh `openssl rand -hex 32`, not the testnet one | Production | No — read at request time |

`.env.example` is the contract between the code and whoever runs it. If
`NEXT_PUBLIC_STELLAR_NETWORK` is not documented there yet, add it in the same
change as §6.2.

### 6.4 Setting them, and why a redeploy is mandatory

```bash
# Values are read from stdin — they do not appear in argv or shell history.
vercel env add NEXT_PUBLIC_STELLAR_NETWORK production
vercel env add DATABASE_URL production
vercel env add ADMIN_TOKEN production

vercel env ls
```

**Changing a `NEXT_PUBLIC_*` variable in the Vercel dashboard does nothing to the
running site.** Next.js inlines those variables into the client bundle at build
time by matching the literal text `process.env.NEXT_PUBLIC_STELLAR_NETWORK` in
the source — the deployed JavaScript contains the string `"public"` or
`"testnet"`, not a lookup. The already-built bundle keeps whatever it was built
with, forever.

The cutover is therefore: set the variable, **then** build:

```bash
vercel --prod
```

Verify the new deployment is actually serving before believing the cutover
happened:

```bash
vercel ls
vercel inspect <deployment-url>
```

`src/config/network.ts` documents the same trap from the other side: it writes
the lookup out literally rather than as `process.env[NETWORK_ENV]`, because a
computed lookup is invisible to the compiler and silently evaluates to
`undefined` in the browser. Preserve that when editing `contract.ts` and
`protocol.ts`.

---

## 7. Database

The database has nothing to do with which chain the app talks to — it holds the
`feedback` table behind `/metrics` and the `users` registry behind `/join`. It
still has to be right before launch, because `/api/health` reports `degraded`
and returns `503` when it is not, and both feedback endpoints answer `503`.

### 7.1 Order of operations

Schema first, code second. Always.

1. Provision a **production** database, separate from whatever testnet has been
   using. Nothing about a launch justifies pointing production at a scratch
   database.
2. Apply the schema:

   ```bash
   psql "$DATABASE_URL" -f db/schema.sql
   ```

   `db/schema.sql` is idempotent — every object is `CREATE … IF NOT EXISTS` — so
   re-running it against a provisioned database is a no-op.
3. Apply the migrations in order:

   ```bash
   psql "$DATABASE_URL" -f db/migrations/001_harden_feedback.sql
   psql "$DATABASE_URL" -f db/migrations/002_users_and_moderation.sql
   ```

   Both are idempotent and safe against live data. On a genuinely new database
   `schema.sql` already contains everything they add, so they are no-ops; run
   them anyway, so the same sequence works whether the database is new or not.
4. **Only then** deploy code that depends on them.

The rule in step 4 is not stylistic. `CREATE TABLE IF NOT EXISTS` is a silent
no-op against an existing table, which is precisely why `001` exists: a database
created before the constraints were written keeps none of them, and `schema.sql`
will not tell you. Code that assumes a column which is not there fails at request
time, in production, on the path a user is on.

### 7.2 Verify before cutover

`db/schema.sql` ends with a verification block. Run it:

```bash
psql "$DATABASE_URL" -c "
  SELECT indexname FROM pg_indexes WHERE tablename = 'feedback' ORDER BY indexname;"
psql "$DATABASE_URL" -c "
  SELECT conname FROM pg_constraint
   WHERE conrelid = 'feedback'::regclass AND contype = 'c' ORDER BY conname;"
psql "$DATABASE_URL" -c "
  SELECT indexname FROM pg_indexes WHERE tablename = 'users' ORDER BY indexname;"
```

Expect 6 indexes and 5 named check constraints on `feedback`, and 4 indexes on
`users` — the counts the schema file documents. A missing partial unique index on
`tx_hash` means duplicate submissions will be accepted.

---

## 8. Verification

Run all of these, in order, immediately after the production build is live.
Every one must pass. A launch is not "done" until this section is done.

### 8.1 Health

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://<production-origin>/api/health
curl -sS https://<production-origin>/api/health | jq
```

Expect `200` and `{"status":"ok","checks":{"database":{"status":"ok",…}}}`. A
`503` with `"status":"degraded"` means the database check failed — the response
deliberately says nothing more, and the real error is in the server log under
the same `requestId`.

Note what this does **not** cover: `/api/health` probes Postgres only. It has no
chain check, so it will report `ok` on a build pointed at the wrong network.

### 8.2 One read from each contract

Read-only calls simulate; they do not sign or submit.

```bash
NETWORK=mainnet
READ_SOURCE=zentra-mainnet-read     # any funded mainnet account

stellar contract invoke --id "$ACTION_LOG" \
  --source "$READ_SOURCE" --network "$NETWORK" -- get_count
stellar contract invoke --id "$ACTION_LOG" \
  --source "$READ_SOURCE" --network "$NETWORK" -- reputation
stellar contract invoke --id "$FEEDBACK" \
  --source "$READ_SOURCE" --network "$NETWORK" -- summary
stellar contract invoke --id "$PROOF_REGISTRY" \
  --source "$READ_SOURCE" --network "$NETWORK" -- get_count
stellar contract invoke --id "$REPUTATION" \
  --source "$READ_SOURCE" --network "$NETWORK" -- score_of --author "$READ_SOURCE"
```

Expected on a fresh deployment: `0`, the reputation id from §5.7, `[0,0]`, `0`,
`0`. The `reputation` call is the important one — it proves the wiring, and a
wrong answer here means §5.4 went wrong and cannot be repaired in place.

### 8.3 One small end-to-end transaction

Do this **once**, with the smallest possible payload, from a wallet you control
and are willing to spend from. It is the first real transaction on the public
network and it is permanent.

1. Open `/app`, connect the wallet, confirm the balance renders and the network
   badge says mainnet.
2. Open `/board`, record one short action.
3. Confirm the transaction succeeds and appears in the live event feed.
4. Re-run §8.2 — `get_count` must now be `1`, and `score_of` for that author
   must be `1`. That single pair of numbers proves the cross-contract call worked
   on mainnet, which is the one thing testnet cannot prove for you.
5. Submit one feedback entry from `/metrics` and confirm it appears, which
   exercises the API, the database and the anchoring path together.

### 8.4 Explorer links resolve to the public network

Every explorer URL is built from `activeProfile.explorerSegment`. On mainnet the
segment must be `public`, not `testnet`.

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  "https://stellar.expert/explorer/public/contract/$ACTION_LOG"
```

Then check it in the browser, from the app itself: click through from a
transaction in the UI and confirm the URL contains `/explorer/public/` and that
the page shows the transaction. A link that renders `/explorer/testnet/` means
the build did not pick up the environment variable — go back to §6.4.

### 8.5 Nothing still points at testnet

```bash
# Should return nothing on a correct mainnet build.
grep -rn "friendbot\|horizon-testnet\|soroban-testnet\|explorer/testnet" src/ \
  --include="*.ts" --include="*.tsx" | grep -v "config/network.ts"
```

`src/config/network.ts` is the one legitimate hit — it holds both profiles by
design. Anything else is a hardcode that survived §6.2.

---

## 9. Rollback

Be precise about this, because half of it is a lie people tell themselves.

| Thing | Reversible? | What you can actually do |
| --- | --- | --- |
| A deployed contract | **No** | It stays on chain forever. You can deploy a replacement at a new id and stop pointing at the old one. The old one remains, callable by anyone who knows its id |
| A submitted transaction | **No** | It is in the ledger. There is no recall, no reversal, no support desk |
| The admin address on `zentra-reputation` | **No** | Set once in `__constructor`. There is no rotation function. A wrong admin means redeploying the contract |
| The action-log → reputation wiring | **No** | Constructor-only. A wrong reputation address means redeploying the action log |
| `set_logger` on the reputation contract | **Yes**, by admin | The admin can re-point it at a different logger |
| Lumens spent on fees and rent | **No** | Spent |
| The frontend's network | **Yes** | Set `NEXT_PUBLIC_STELLAR_NETWORK=testnet` and redeploy |
| The deployed frontend build | **Yes** | `vercel rollback` to the previous production deployment |
| A database migration | **Partially** | `001` and `002` are additive and safe to leave in place; data written under them is not undone by removing them |
| Personal data collected in `users` | **No** | Once someone's name and email are in the registry, a rollback does not unlearn them |

### 9.1 The frontend rollback

This is the only fast, complete reversal available:

```bash
vercel rollback              # back to the previous production deployment
# or, deliberately:
vercel env rm NEXT_PUBLIC_STELLAR_NETWORK production
vercel --prod                # unset ⇒ resolveNetwork returns 'testnet'
```

The fail-safe default in `resolveNetwork` means that removing the variable is
itself a rollback: absent or unrecognised resolves to `testnet`.

### 9.2 The asymmetry, stated plainly

Rolling back the frontend takes about a minute and costs nothing. Rolling back a
contract deployment is not a thing that exists. Everything on the chain side of
the line is permanent from the moment it is signed.

That is why §2 has seven gates and why they are absolute rather than
advisory. The gates are the only rollback the chain side has, and they only work
before the fact.

---

## 10. Post-launch

### 10.1 Monitoring

| Signal | Source | Already in place |
| --- | --- | --- |
| Readiness | `GET /api/health` — `200` / `503` | Yes |
| Web vitals, traffic | Vercel Speed Insights + Web Analytics | Yes, mounted in `src/app/layout.tsx` |
| Request-level errors | Structured log lines, one per request, keyed by `requestId` | Yes, via `route()` |
| On-chain usage | `/metrics` | Yes |
| Contract TTL headroom | Nothing | **No — see §10.4** |

### 10.2 Alerting

Point an external uptime monitor at `/api/health` before launch, not after.

- Alert on any non-`200`. The endpoint returns `503` the moment a dependency
  check fails, so the status code alone is sufficient — no body parsing needed.
- Alert on two consecutive failures rather than one, to absorb a cold start.
- The endpoint is safe to expose publicly: the body carries no environment
  variables, versions, hostnames or dependency URLs, and a failing check reports
  a fixed generic `unavailable` string.

### 10.3 Watch for, in the first 48 hours

- `409 conflict` on `POST /api/feedback` — a duplicate `tx_hash`. Expected on a
  double-click; a burst of them is a bug.
- `503 upstream_unavailable` — the database, or an unset `ADMIN_TOKEN`.
- `429 rate_limited` — either abuse or a limit set too tight for real traffic.
- Feedback rows claiming `on_chain` that Horizon does not confirm — the anchor
  verification path is resolving against the wrong network.

### 10.4 TTL and rent extension — a standing task

This is the operational cost that outlives the launch. Set a recurring calendar
reminder, owned by a named person, at an interval **shorter than the shortest
window in §4.3** — 30 days is the instance window, so a 14-day cadence leaves
room to miss one.

```bash
stellar contract extend --id "$ACTION_LOG" \
  --source "$SOURCE" --network mainnet \
  --durability persistent --ledgers-to-extend 518400   # ~30 days at 5s ledgers
```

Repeat for all four ids. Verify the flags against `stellar contract extend --help`
on your installed CLI before relying on the exact form.

A quiet contract is the risk here, not a busy one — writes self-extend, silence
does not. An archived instance makes reads fail until it is restored, and
restoration is a separate operation with its own cost.

### 10.5 Incident contact

> **Named on-call contact: _[TO BE FILLED IN BEFORE LAUNCH]_**

One person, reachable, who knows they hold it, and who has read §9 before the
incident rather than during it. `SECURITY.md` covers inbound vulnerability
reports; this is the outbound path for the project's own failures.

---

## 11. Open decisions

None of the following is decided. Each is a genuine gap, listed so that nobody
discovers it mid-launch and improvises.

| # | Decision | Why it matters | Current state |
| --- | --- | --- | --- |
| 1 | **Upgrade strategy** | No contract implements an upgrade entry point. Fixing a bug means deploying at a new id and migrating, and the existing state does not come with it | Not designed |
| 2 | **Pause / kill switch** | Nothing can stop `record`, `submit` or `anchor`. A discovered vulnerability has no on-chain mitigation — only taking the frontend down, which does not stop direct contract calls | Not designed |
| 3 | **Admin key rotation** | `Reputation`'s admin is set once in `__constructor` with no rotation function. A compromised admin key means redeploying the contract | No mechanism exists |
| 4 | **Who holds custody** | §3.2 lists the options and does not choose. This needs a name, not a mechanism | Undecided |
| 5 | **Personal data retention** | The `users` table holds names and email addresses with no retention policy, no deletion path, and no stated purpose limitation. `GET /api/admin/users` exports the lot behind one shared secret | Undecided |
| 6 | **`ADMIN_TOKEN` rotation** | One process-wide shared secret, no rotation procedure, no expiry. It fails closed when unset, which is right, but nothing says when it changes | Undecided |
| 7 | **`zentra-multisig`** | Exists in the tree, absent from CI, absent from `contract.ts`, undeployed. Either it ships and needs a CI job, an audit and a place in this runbook, or it is removed | Undecided |
| 8 | **Mainnet `readSource`** | Read simulations need a funded mainnet account. Which one, funded by whom, and what happens when it empties | Undecided |
| 9 | **Testnet after mainnet** | Whether the testnet deployment stays live as a staging environment, and if so how the two are kept from being confused | Undecided |
| 10 | **Incident response** | §10.5 has a blank. So does the question of what the response actually is, given decision 2 | Undecided |

Decisions 1, 2 and 3 are the load-bearing ones. Together they mean that today,
a critical bug found after a mainnet deployment has no on-chain remedy at all —
which is the strongest argument in this document for keeping gate 1 closed until
an independent audit says otherwise.
