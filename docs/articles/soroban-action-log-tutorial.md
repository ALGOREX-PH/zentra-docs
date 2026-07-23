# Build and ship an on-chain action log on Soroban

A complete walk-through of a real, deployed two-contract Soroban system — storage, events, cross-contract calls, tests, deployment, and a React frontend that reads and writes it.

**Estimated reading time: 25 minutes** (much of it code). Longer if you build along, which is the point.

---

## 1. What you will build

An **action log**: a Soroban contract on Stellar testnet that lets any account write a short message on-chain, stores each message as a numbered entry, emits a typed event so a frontend can stream new entries live, and — on every write — makes a cross-contract call into a second contract that tracks a per-author reputation score. Then a React page that reads the log without asking anyone to sign anything, and writes to it through a browser wallet.

Everything below is taken from a system that is deployed and running. Nothing here is pseudocode.

- Live demo: <https://zentra-docs.vercel.app/board>
- Repository: <https://github.com/ALGOREX-PH/zentra-docs>
- The contracts live in `contracts/zentra-action-log/` and `contracts/zentra-reputation/`; the client code in `src/lib/stellar/`.

By the end you will have covered:

- Soroban storage — `instance` vs `persistent`, and the TTL/archival model that makes the choice matter.
- `require_auth` and what authorisation means when one contract calls another.
- Typed events with `#[contractevent]`, and typed cross-contract clients with `#[contractclient]`.
- Constructor arguments via `__constructor`, so a contract is wired at deploy time rather than by a separate `init` call anyone could front-run.
- Unit tests with `Env::default()` and `mock_all_auths()`, including an event assertion.
- The build → deploy → wire workflow with the Stellar CLI.
- Reading a contract by **simulating** an invocation (free, no signature), and writing by building an unsigned XDR, signing it in the wallet, submitting it, and polling for the result.
- Streaming `recorded` events with a ledger cursor.

This tutorial assumes you can write Rust and TypeScript. It assumes you have never written a Soroban contract.

---

## 2. Prerequisites

**Rust and the wasm target.** Soroban contracts compile to WebAssembly. Recent Stellar tooling targets `wasm32v1-none`, not the older `wasm32-unknown-unknown` you will see in tutorials written before 2025:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32v1-none
```

**The Stellar CLI.** It builds, deploys, and invokes contracts, and manages the local identities you deploy from:

```bash
cargo install --locked stellar-cli
stellar --version
```

Configure testnet and create a funded identity. `contracts/deploy.sh` in this repo resolves the deployer's address with `stellar keys address "$SOURCE"`, so the identity name you pick here is the `SOURCE` you will pass later:

```bash
stellar network use testnet
stellar keys generate --global zentra-deployer --network testnet --fund
stellar keys address zentra-deployer      # G... — this is your deployer account
```

**The soroban-sdk version.** Both contracts pin the same version. From `contracts/zentra-action-log/Cargo.toml`:

```toml
[package]
name = "zentra-action-log"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]
doctest = false

[dependencies]
soroban-sdk = "26.1.0"

[dev-dependencies]
soroban-sdk = { version = "26.1.0", features = ["testutils"] }

[profile.release]
opt-level = "z"
overflow-checks = true
debug = 0
strip = "symbols"
debug-assertions = false
panic = "abort"
codegen-units = 1
lto = true
```

Three details in that file are worth pausing on, because they are not decoration:

- `crate-type = ["cdylib"]` — you are building a dynamic library that the Soroban host loads, not a binary.
- The `testutils` feature under `[dev-dependencies]` is what gives you `Env::default()`, `Address::generate`, `mock_all_auths()`, and the generated test client. Without it, your tests will not compile.
- The `[profile.release]` block exists because **wasm size is a real cost on-chain**. `opt-level = "z"`, `lto = true`, `codegen-units = 1`, `strip = "symbols"` and `panic = "abort"` together produce a meaningfully smaller upload. `overflow-checks = true` stays on deliberately: a silent integer wrap in a contract that mints or counts is a bug you cannot fix after deployment.

**Frontend.** Node ≥ 20 or [Bun](https://bun.sh) ≥ 1.3, and the [Freighter](https://www.freighter.app) browser extension **set to Test Net**. This is the single most common source of "why does nothing happen" — Freighter defaults to Mainnet, and a testnet transaction signed against the mainnet passphrase is simply invalid.

---

## 3. The contract

We will build `contracts/zentra-action-log/src/lib.rs` in stages. Every snippet below is the real code from that file.

### 3.1 The skeleton

```rust
#![no_std]
use soroban_sdk::{
    contract, contractclient, contractevent, contracterror, contractimpl, contracttype, vec,
    Address, Env, String, Vec,
};
```

`#![no_std]` is mandatory. There is no operating system inside the Soroban host — no filesystem, no clock, no allocator you control. Everything you would reach for in `std` has a host-provided equivalent: `soroban_sdk::String` instead of `alloc::string::String`, `soroban_sdk::Vec` instead of `std::vec::Vec`, `env.ledger().sequence()` instead of a wall clock. These types are handles into host memory, not Rust-side buffers, which is why they are cheap to pass around and why they always need `&env` to construct.

### 3.2 Storage keys, and why the enum

```rust
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Count,
    Reputation,
    Entry(u64),
}
```

Soroban storage is a key-value map where both key and value are `ScVal` — the host's value type. You *could* key on raw symbols or integers. Using a `#[contracttype]` enum instead buys you two things: the compiler stops you from typo-ing a key, and the variant with a payload (`Entry(u64)`) gives you a clean namespaced family of keys — entry 0, entry 1, entry 2 — that cannot collide with `Count` or `Reputation`.

`#[contracttype]` is what makes the enum serialisable to and from `ScVal`. Any type crossing the contract boundary — arguments, return values, stored values, event fields — needs it.

### 3.3 The stored entry and the event type

```rust
/// One recorded action: who, what, and when (by ledger).
#[contracttype]
#[derive(Clone)]
pub struct Entry {
    pub index: u64,
    pub author: Address,
    pub message: String,
    pub ledger: u32,
    pub score: u32,
}

/// Emitted whenever an action is recorded — the frontend streams these for the
/// live feed (topic `recorded`, data carries the full entry).
#[contractevent(topics = ["recorded"])]
pub struct Recorded {
    pub index: u64,
    pub author: Address,
    pub message: String,
    pub ledger: u32,
    pub score: u32,
}
```

`#[contractevent]` is the modern way to define events. Before it, you emitted events by hand-assembling a tuple of topics and a data value, and every consumer had to agree on the tuple's shape by convention. With `#[contractevent]`, the struct *is* the schema: the macro generates a `publish(&env)` method, and the declared `topics` are what indexers and RPC filter on.

Note the deliberate redundancy: `Recorded` carries the same fields as `Entry`. That is not laziness — it is what lets the frontend build its entire feed from events alone, with no follow-up contract read per entry. An event that only says "index 7 changed" forces every listener into a round trip.

There is no timestamp field. `env.ledger().sequence()` — the ledger number — is the honest on-chain notion of "when". A ledger closes roughly every 5 seconds, which is precise enough for ordering and cannot be manipulated by the caller.

### 3.4 Errors

```rust
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    EmptyMessage = 1,
    MessageTooLong = 2,
}
```

A contract function that returns `Result<T, Error>` gives callers a structured failure they can match on, instead of a panic that surfaces as an opaque host error. The explicit `#[repr(u32)]` discriminants are part of your public interface — renumbering them later is a breaking change for anyone who wrote code against them.

### 3.5 The constructor

```rust
#[contract]
pub struct ActionLog;

#[contractimpl]
impl ActionLog {
    /// Wire the reputation contract this log bumps on each recorded action.
    pub fn __constructor(env: Env, reputation: Address) {
        env.storage().instance().set(&DataKey::Reputation, &reputation);
    }

    /// The reputation contract this log calls cross-contract.
    pub fn reputation(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Reputation).unwrap()
    }
```

`__constructor` runs exactly once, atomically, as part of the deployment transaction. This matters more than it looks. The older pattern — deploy, then call a separate `init(...)` in a second transaction — leaves a window in which the contract exists but is unconfigured, and anyone watching the ledger can call `init` first with their own arguments. A constructor closes that window entirely: there is no observable state in which the log exists without knowing its reputation contract.

The `.unwrap()` in `reputation()` is safe precisely *because* of the constructor. The key cannot be absent.

### 3.6 `record` — auth, validation, storage, event

Here is the whole function. We will take it apart afterwards.

```rust
    /// Record an action authored by `author`. Stores it, bumps the global
    /// count, emits a `recorded` event, and returns the new entry's index.
    pub fn record(env: Env, author: Address, message: String) -> Result<u64, Error> {
        author.require_auth();

        let len = message.len();
        if len == 0 {
            return Err(Error::EmptyMessage);
        }
        if len > MAX_MESSAGE_LEN {
            return Err(Error::MessageTooLong);
        }

        let index: u64 = env.storage().instance().get(&DataKey::Count).unwrap_or(0);

        // Cross-contract call: bump the author's reputation and fold the new
        // score into the entry. Soroban auto-authorizes this log for the call,
        // and the reputation contract checks this log is the registered caller.
        let reputation: Address = env.storage().instance().get(&DataKey::Reputation).unwrap();
        let score = ReputationClient::new(&env, &reputation)
            .bump(&env.current_contract_address(), &author);

        let entry = Entry {
            index,
            author: author.clone(),
            message: message.clone(),
            ledger: env.ledger().sequence(),
            score,
        };

        env.storage().persistent().set(&DataKey::Entry(index), &entry);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Entry(index), ENTRY_THRESHOLD, ENTRY_BUMP);

        env.storage().instance().set(&DataKey::Count, &(index + 1));
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_BUMP);

        Recorded {
            index,
            author,
            message,
            ledger: entry.ledger,
            score,
        }
        .publish(&env);

        Ok(index)
    }
```

**`author.require_auth()` is the whole security model.** Soroban does not hand you a `msg.sender`. Instead, you name the account whose authorisation you require, and the host verifies that this account signed an authorisation entry covering *this contract, this function, these exact arguments*. It is the first line of the function for a reason: nothing should happen before you know the caller is who they claim to be.

The consequence is stricter than an implicit sender: because the signed authorisation payload includes the arguments, a signature for `record(alice, "hello")` cannot be replayed as `record(alice, "goodbye")`. It also means `author` is a parameter, so the same function works whether Alice signs directly or a smart-account contract authorises on her behalf.

**Validate before you write.** `message.len()` on a `soroban_sdk::String` is the host-side length. The check returns a typed error rather than panicking — the frontend can then render "message too long" instead of "transaction failed".

**Bounded input is a security control, not politeness.** Without `MAX_MESSAGE_LEN`, one caller could park an arbitrarily large blob in your contract's storage. They pay the fee, but you inherit the read cost forever — and reading it back may not fit in a transaction's resource budget.

The constants at the top of the file:

```rust
const DAY_LEDGERS: u32 = 17_280; // ~1 day at 5s ledgers
const INSTANCE_BUMP: u32 = 30 * DAY_LEDGERS;
const INSTANCE_THRESHOLD: u32 = INSTANCE_BUMP - DAY_LEDGERS;
const ENTRY_BUMP: u32 = 90 * DAY_LEDGERS;
const ENTRY_THRESHOLD: u32 = ENTRY_BUMP - DAY_LEDGERS;
const MAX_MESSAGE_LEN: u32 = 200;
const MAX_RECENT: u32 = 20;
```

### 3.7 `instance` vs `persistent` — the choice that actually matters

The log uses two storage types, and the split is intentional:

| Data | Storage | Why |
| --- | --- | --- |
| `DataKey::Count`, `DataKey::Reputation` | `instance` | Small, singular, read on every call, lives and dies with the contract. |
| `DataKey::Entry(n)` | `persistent` | Unbounded in number; each entry is independent and must survive on its own. |

**Instance storage** is a single bundle attached to the contract instance itself. Every entry in it is loaded whenever the contract is invoked, and it shares one TTL with the contract. That makes it perfect for a handful of config values and counters — and completely wrong for a growing collection, because the cost of loading it grows with every item you add and is paid by *every* call, including calls that never touch that data. Put your action entries in instance storage and your contract gets slower and more expensive with every write until it stops fitting in a transaction.

**Persistent storage** gives each key its own entry with its own TTL, loaded only when that key is actually read. Unbounded collections belong here.

(There is a third, `temporary`, for data that is fine to lose — nonces, short-lived claims. Nothing in this contract wants it.)

### 3.8 TTL, and the failure mode nobody warns you about

Soroban has **state archival**. A storage entry has a time-to-live measured in ledgers; when it lapses, the entry is archived and is no longer readable. Instance storage archiving means your *contract* is archived — invocations fail until someone restores it. This is not a theoretical risk; it is the single most common way a demo contract is dead a month after the hackathon.

The defence is two lines, in the write path:

```rust
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Entry(index), ENTRY_THRESHOLD, ENTRY_BUMP);

        env.storage().instance().set(&DataKey::Count, &(index + 1));
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_BUMP);
```

Read `extend_ttl(threshold, extend_to)` as: *if this entry's remaining life has dropped below `threshold` ledgers, top it back up to `extend_to` ledgers.*

The threshold constants are defined as `BUMP - DAY_LEDGERS`, which reads oddly until you see the intent: the threshold sits one day below the target, so a top-up happens if the entry has aged by more than a day, and not on every single call. You get near-continuous liveness without paying the extension fee on writes seconds apart.

Entries get 90 days; the instance gets 30. The instance is renewed by *any* write, so it is the more frequently refreshed of the two; individual entries may never be touched again after they are created, so they start with a longer runway.

An important limitation to internalise: **a contract can only extend TTLs while someone is invoking it.** If nobody calls your contract for 30 days, nothing in the code above runs. Anything you intend to keep alive indefinitely needs either regular traffic or an external keeper that periodically extends it.

### 3.9 Reads, and why `get_recent` is capped

```rust
    /// Total number of actions recorded.
    pub fn get_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::Count).unwrap_or(0)
    }

    /// Fetch a single entry by index, if it exists.
    pub fn get_entry(env: Env, index: u64) -> Option<Entry> {
        env.storage().persistent().get(&DataKey::Entry(index))
    }

    /// The most recent entries, newest first (capped at 20 to bound the read).
    pub fn get_recent(env: Env, limit: u32) -> Vec<Entry> {
        let count: u64 = env.storage().instance().get(&DataKey::Count).unwrap_or(0);
        let mut out: Vec<Entry> = vec![&env];
        let capped = if limit > MAX_RECENT { MAX_RECENT } else { limit };
        if count == 0 || capped == 0 {
            return out;
        }

        let mut i: u64 = count;
        let mut taken: u32 = 0;
        while i > 0 && taken < capped {
            i -= 1;
            let entry: Option<Entry> = env.storage().persistent().get(&DataKey::Entry(i));
            if let Some(entry) = entry {
                out.push_back(entry);
            }
            taken += 1;
        }
        out
    }
```

**The unbounded read is a trap, and it is worth being precise about why.** The obvious `get_all()` that loops from 0 to `count` works beautifully in tests, works on day one with three entries, and then fails permanently. Every Soroban invocation — including a simulated, read-only one — runs under hard resource limits: CPU instructions, memory, and the number and size of ledger entries it may read. Cross that ceiling and the call errors out. There is no partial result and no pagination you can bolt on afterwards, because the function signature is already deployed. Your read endpoint has effectively bricked itself, and the only fix is to deploy a new contract.

So `get_recent` refuses to trust its own caller. The user supplies `limit`, but `MAX_RECENT` is the ceiling that actually governs. A caller asking for 10,000 gets 20.

Two smaller details in that loop:

- It walks **backwards** from `count`, so results come out newest-first without a sort. Reverse chronological is what a feed wants anyway.
- `taken` counts *positions scanned*, not entries returned. If an old entry was archived and `get` returns `None`, the loop skips it but still consumes a slot. That is deliberate: the number of storage reads stays bounded by `capped` no matter how many gaps exist in the history. A version that only counted successes could scan the entire history looking for 20 live entries — reintroducing exactly the unbounded read the cap exists to prevent.

Note also that `get_entry` returns `Option<Entry>` rather than panicking on a missing index. A read that a frontend may call speculatively should return "nothing there", not fail the whole simulation.

---

## 4. Cross-contract calls

The log does not implement reputation. A second contract, `zentra-reputation`, owns that state. The log calls into it on every write.

### 4.1 A typed handle with `#[contractclient]`

```rust
/// The slice of the Reputation contract this log calls cross-contract.
#[contractclient(name = "ReputationClient")]
pub trait Reputation {
    fn bump(env: Env, logger: Address, author: Address) -> u32;
}
```

You declare only the *slice of the interface you actually use* — one method — and the macro generates `ReputationClient`, a typed struct with a `bump` method. Call it like this:

```rust
        let reputation: Address = env.storage().instance().get(&DataKey::Reputation).unwrap();
        let score = ReputationClient::new(&env, &reputation)
            .bump(&env.current_contract_address(), &author);
```

The value here is compile-time safety across a contract boundary. Without it you would be assembling a symbol and a `Vec<Val>` by hand and hoping the callee's signature matches; with it, a mismatch in argument types or arity is a compile error in your own crate. You do not need the callee's source — a trait declaration is enough, which is exactly how you integrate with a contract someone else deployed.

The address is read from storage rather than hard-coded, and it was set by the constructor. Hard-coding a callee id means recompiling to point at a different deployment, which makes testnet and mainnet builds diverge.

### 4.2 Authorisation across the boundary

This is the part that trips people up. Here is the callee, from `contracts/zentra-reputation/src/lib.rs`:

```rust
    /// Increment `author`'s reputation by one and return the new score.
    ///
    /// `logger` is the calling contract's own address. Soroban auto-authorizes
    /// a contract for the direct sub-calls it makes, so `logger.require_auth()`
    /// passes only when the registered Action Log contract is the caller.
    pub fn bump(env: Env, logger: Address, author: Address) -> Result<u32, Error> {
        logger.require_auth();
        let registered: Address = env
            .storage()
            .instance()
            .get(&DataKey::Logger)
            .ok_or(Error::LoggerNotSet)?;
        if logger != registered {
            return Err(Error::Unauthorized);
        }

        let key = DataKey::Score(author.clone());
        let score: u32 = env.storage().persistent().get(&key).unwrap_or(0) + 1;
        env.storage().persistent().set(&key, &score);
        env.storage().persistent().extend_ttl(&key, THRESHOLD, BUMP);

        Bumped { author, score }.publish(&env);
        Ok(score)
    }
```

`Address` in Soroban covers both accounts (`G...`) and contracts (`C...`), and `require_auth()` works on both. For a contract address, the host's rule is: **a contract is automatically authorised for the direct sub-calls it makes.** So when the action log calls `bump` passing `env.current_contract_address()`, the `logger.require_auth()` inside `bump` succeeds — the host knows the log is genuinely the caller in this frame.

That check alone proves *some contract* is calling. It does not prove *which*. Hence the second half:

```rust
        if logger != registered {
            return Err(Error::Unauthorized);
        }
```

`require_auth` establishes authenticity; the comparison against the registered logger establishes authorisation. An attacker can deploy their own contract that calls `bump` and passes its own address — `require_auth` will pass for them too — and the equality check is what rejects it. **Authentication and authorisation are separate steps, and skipping the second is the classic Soroban access-control bug.**

The registration itself is admin-gated, and the admin was fixed at deploy time by the constructor:

```rust
    /// Set the admin once, at deployment.
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    /// Authorize a single Action Log contract as the only caller allowed to
    /// `bump`. Admin-gated.
    pub fn set_logger(env: Env, logger: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::Logger, &logger);
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
    }
```

The end-to-end flow, from the repo's own README:

```
record(author, message)                       [zentra-action-log]
  │  author.require_auth()
  │  store entry + bump global count
  └─▶ reputation.bump(self, author) ─────────▶ [zentra-reputation]
        (self = current contract address)        logger.require_auth()  ← only the
                                                  registered Action Log may bump
        new score  ◀───────────────────────────  score[author] += 1; emit `bumped`
  store score in entry; emit `recorded`
```

One transaction, two contracts, two events, one atomic outcome. If `bump` errors, the whole `record` reverts — there is no state in which an action was logged but the reputation call silently failed.

---

## 5. Testing

Soroban's test environment is not a mock. `Env::default()` gives you a real host with real storage, real auth, real event capture, running in-process. Tests are fast and they exercise the same code paths the network will.

### 5.1 A stand-in for the callee

Testing the log means the reputation contract has to exist. Rather than pulling in the real one, `contracts/zentra-action-log/src/test.rs` registers a minimal stand-in:

```rust
#![cfg(test)]
use super::*;
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Events as _},
    Address, Env, String,
};

// A stand-in reputation contract: every `bump` returns an incrementing counter,
// which is enough to prove the cross-contract call folded the score into a record.
#[contract]
pub struct MockReputation;

#[contractimpl]
impl MockReputation {
    pub fn bump(env: Env, _logger: Address, _author: Address) -> u32 {
        let n: u32 = env.storage().instance().get(&0u32).unwrap_or(0) + 1;
        env.storage().instance().set(&0u32, &n);
        n
    }
}

fn setup(env: &Env) -> ActionLogClient<'_> {
    let reputation = env.register(MockReputation, ());
    let id = env.register(ActionLog, (reputation,));
    ActionLogClient::new(env, &id)
}
```

Three things to notice.

`env.register(Contract, constructor_args)` deploys a contract into the test host and returns its address. The second argument is the tuple of constructor arguments: `()` for the mock (no constructor), `(reputation,)` for the log — that single-element tuple *is* the `reputation: Address` parameter of `__constructor`. This is the same wiring the real deployment does, exercised in the test.

`ActionLogClient` is generated for you by `#[contractimpl]`. You never call contract functions directly in tests; you go through the client, which routes through the host exactly as a real invocation would — including auth and cross-contract dispatch.

The mock is a genuine contract, not a stub. That means the cross-contract call in `record` is a real cross-contract call in the test.

### 5.2 The happy path

```rust
#[test]
fn records_and_counts() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);
    let alice = Address::generate(&env);

    assert_eq!(client.get_count(), 0);

    let index = client.record(&alice, &String::from_str(&env, "gm stellar"));
    assert_eq!(index, 0);
    assert_eq!(client.get_count(), 1);

    let entry = client.get_entry(&0).unwrap();
    assert_eq!(entry.author, alice);
    assert_eq!(entry.message, String::from_str(&env, "gm stellar"));
    assert_eq!(entry.score, 1);
}
```

`env.mock_all_auths()` makes every `require_auth()` in the test succeed. Without it, `record` fails immediately, because `Address::generate(&env)` produces an address with no signer attached. Use it when the subject of the test is business logic. When the subject is *access control itself*, drop it and assert the specific auth entries instead — a test that runs with `mock_all_auths()` proves nothing about who is allowed to call what.

`String::from_str(&env, "…")` — every host type needs the env to be constructed.

`entry.score == 1` is the assertion that the cross-contract call actually happened and its return value was folded into the stored entry.

### 5.3 The cross-contract effect, over two calls

```rust
#[test]
fn bumps_author_reputation() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);
    let alice = Address::generate(&env);

    client.record(&alice, &String::from_str(&env, "one"));
    assert_eq!(client.get_entry(&0).unwrap().score, 1);
    client.record(&alice, &String::from_str(&env, "two"));
    assert_eq!(client.get_entry(&1).unwrap().score, 2);
}
```

State persists across calls within one `Env`, so this tests accumulation, not just a single invocation.

### 5.4 Ordering

```rust
#[test]
fn recent_is_newest_first() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);
    let author = Address::generate(&env);

    client.record(&author, &String::from_str(&env, "one"));
    client.record(&author, &String::from_str(&env, "two"));
    client.record(&author, &String::from_str(&env, "three"));

    let recent = client.get_recent(&2);
    assert_eq!(recent.len(), 2);
    assert_eq!(recent.get(0).unwrap().message, String::from_str(&env, "three"));
    assert_eq!(recent.get(1).unwrap().message, String::from_str(&env, "two"));
}
```

This pins both the cap (three recorded, two requested, two returned) and the newest-first ordering the frontend depends on.

### 5.5 Asserting a typed error

```rust
#[test]
fn rejects_empty_message() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);
    let author = Address::generate(&env);

    let result = client.try_record(&author, &String::from_str(&env, ""));
    assert_eq!(result, Err(Ok(Error::EmptyMessage)));
    assert_eq!(client.get_count(), 0);
}
```

The generated client has two forms of each method. `client.record(...)` panics on failure. `client.try_record(...)` returns a `Result` you can assert against — use it whenever you expect an error.

The doubly-nested `Err(Ok(Error::EmptyMessage))` is not a typo. The outer `Err` says the invocation failed; the inner `Ok` says the failure was *your* declared contract error rather than an unrecognised host error. If you had a bug that produced a host panic instead, you would get `Err(Err(...))` and the assertion would fail — which is precisely the discrimination you want.

The second assertion — `get_count() == 0` — is the one people forget. It proves the failed call left **no** state behind.

### 5.6 Asserting an event

```rust
#[test]
fn emits_recorded_event() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);
    let author = Address::generate(&env);

    client.record(&author, &String::from_str(&env, "hi"));
    assert_eq!(env.events().all().events().len(), 1);
}
```

`env.events()` (from the `Events` testutils trait, imported as `Events as _`) captures everything published during the test. Here the assertion is a count — the log emitted exactly one event, no more. Since the frontend feed is driven entirely by events, an accidental double-emit would show duplicate entries in the UI, and this catches it.

If you want to assert the *contents* of an event, `env.events().all()` gives you the full records — contract id, topics, and data — which you can destructure and compare field by field. The equivalent test in the reputation contract's own suite, `contracts/zentra-reputation/src/test.rs`, follows the same shape:

```rust
#[test]
fn rejects_unregistered_logger() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = deploy(&env);

    let logger = Address::generate(&env);
    client.set_logger(&logger);

    let imposter = Address::generate(&env);
    let author = Address::generate(&env);
    assert_eq!(
        client.try_bump(&imposter, &author),
        Err(Ok(Error::Unauthorized)),
    );
}
```

That is the test that proves the authentication/authorisation split from section 4.2 actually holds: the imposter passes `require_auth` (because `mock_all_auths` is on) and is still rejected by the registered-logger comparison.

### 5.7 Running them

```bash
cd contracts/zentra-action-log
cargo test
```

And in CI — from `.github/workflows/ci.yml`, which runs each contract's suite off its own manifest so a shared workspace is not required:

```yaml
      - name: Test reputation contract
        run: cargo test --manifest-path contracts/zentra-reputation/Cargo.toml
      - name: Test action-log contract
        run: cargo test --manifest-path contracts/zentra-action-log/Cargo.toml
```

A note on the `test_snapshots/` directory that appears after your first run: the SDK writes a JSON snapshot of the host state for each test. Commit them. A diff in a snapshot on an unrelated change is an early warning that your contract's storage or event footprint moved.

---

## 6. Build and deploy

Two contracts with a dependency between them means the order matters: reputation first (the log's constructor needs its address), then the log, then wire them.

`contracts/deploy.sh` is the real workflow, and it is short enough to read in full:

```bash
#!/usr/bin/env bash
#
# Zentra two-contract deployment workflow (Stellar testnet).
# Builds, deploys, and wires the Reputation + Action Log contracts, then prints
# the ids to paste into src/config/contract.ts.
#
# Usage:  SOURCE=zentra-deployer ./contracts/deploy.sh
#
set -euo pipefail

NETWORK="${NETWORK:-testnet}"
SOURCE="${SOURCE:-zentra-deployer}"
ADMIN="${ADMIN:-$(stellar keys address "$SOURCE")}"

cd "$(dirname "$0")"

echo "==> Building contracts"
( cd zentra-reputation && stellar contract build )
( cd zentra-action-log && stellar contract build )

REP_WASM="zentra-reputation/target/wasm32v1-none/release/zentra_reputation.wasm"
LOG_WASM="zentra-action-log/target/wasm32v1-none/release/zentra_action_log.wasm"

echo "==> Deploying reputation (admin=$ADMIN)"
REPUTATION=$(stellar contract deploy --wasm "$REP_WASM" \
  --source "$SOURCE" --network "$NETWORK" -- --admin "$ADMIN")
echo "    reputation = $REPUTATION"

echo "==> Deploying action log (reputation=$REPUTATION)"
ACTION_LOG=$(stellar contract deploy --wasm "$LOG_WASM" \
  --source "$SOURCE" --network "$NETWORK" -- --reputation "$REPUTATION")
echo "    action_log = $ACTION_LOG"

echo "==> Authorizing the action log as the reputation's logger"
stellar contract invoke --id "$REPUTATION" \
  --source "$SOURCE" --network "$NETWORK" -- set_logger --logger "$ACTION_LOG"

echo
echo "Deployed and wired on $NETWORK:"
echo "  reputation = $REPUTATION"
echo "  action_log = $ACTION_LOG"
echo
echo "Paste these into src/config/contract.ts."
```

Run it:

```bash
SOURCE=zentra-deployer ./contracts/deploy.sh
```

The details worth extracting:

**`stellar contract build`** compiles for `wasm32v1-none` and applies the release profile from `Cargo.toml`. The artefact path — `target/wasm32v1-none/release/zentra_action_log.wasm` — uses the crate name with hyphens converted to underscores. That path is the most common early stumbling block; if the file is not where you expect, check both the target triple and the underscore.

**The bare `--` separator** is the crux of the CLI's argument model. Everything before it configures the CLI (`--wasm`, `--source`, `--network`); everything after it is passed to the *contract*. So `-- --admin "$ADMIN"` supplies the `admin: Address` parameter of the reputation contract's `__constructor`, and `-- --reputation "$REPUTATION"` supplies the log's. Constructor arguments are named after the Rust parameter, in kebab form.

**`--network testnet`** resolves the RPC endpoint and — critically — the network passphrase. Deploy without it and you will either hit a network you did not intend or fail signature verification.

**The order is forced by the dependency.** Reputation must exist before the log's constructor can be given its address. Then `set_logger` closes the loop in the other direction. That third step is a normal `contract invoke`, admin-authorised, and it is the only mutable piece of the wiring.

**Verify it deployed** before touching the frontend:

```bash
stellar contract invoke --id "$ACTION_LOG" --source zentra-deployer --network testnet \
  -- get_count
```

The deployed instances this tutorial is drawn from:

- Action log: `CCSXFTQTWVSHUMH2C64RJKY7JKCVHD5REFIW3P3YPVY6PWHVSJ7ZDDES`
- Reputation: `CA2QOMGVQ5XWGFDYT5XEJ7EQ6B6H4ZNDAPS337P3BT55XY3DJY4AIIPI`

---

## 7. The frontend

Client code lives in `src/lib/stellar/`. Configuration is centralised so that nothing can disagree about which network it is on.

`src/config/stellar.ts`:

```ts
import { Networks } from '@stellar/stellar-sdk';

export const stellar = {
  network: 'testnet',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  friendbotUrl: 'https://friendbot.stellar.org',
  networkPassphrase: Networks.TESTNET,
  /** Stellar Expert links so users can independently verify a result on-chain. */
  explorerTxUrl: (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`,
  explorerAccountUrl: (address: string) =>
    `https://stellar.expert/explorer/testnet/account/${address}`,
} as const;
```

`src/config/contract.ts` — the deployed ids, plus one thing that will make sense in a moment:

```ts
export const actionLog = {
  contractId: 'CCSXFTQTWVSHUMH2C64RJKY7JKCVHD5REFIW3P3YPVY6PWHVSJ7ZDDES',
  /** The reputation contract the action log bumps via a cross-contract call. */
  reputationId: 'CA2QOMGVQ5XWGFDYT5XEJ7EQ6B6H4ZNDAPS337P3BT55XY3DJY4AIIPI',
  // … other contract ids elided …
  /** Ledger of the first recorded action — a floor for event history. */
  deployLedger: 3348158,
  /** Funded testnet account used purely as the source for read simulations. */
  readSource: 'GDUY4FYOA7C5FF45OL5HN2IMVE5CDXO2DZZQNKQXVVDRNCXOSDRHY7LO',
} as const;
```

And one RPC client for the whole app (`src/lib/stellar/rpc.ts`):

```ts
import { rpc } from '@stellar/stellar-sdk';
import { stellar } from '@/config/stellar';

/**
 * One Soroban RPC client for the dApp, pinned to testnet.
 *
 * RPC (not Horizon) is the contract surface: it simulates read-only calls,
 * assembles invoke transactions with the right resources, submits them, and
 * serves `getEvents` for the live action feed.
 */
export const soroban = new rpc.Server(stellar.rpcUrl);
```

### 7.1 Reading is simulating — no signature, no fee, no transaction

This is the insight most Soroban tutorials skip, and it changes how you design a dApp.

**A contract read is not a transaction.** You build a transaction envelope, hand it to RPC's `simulateTransaction`, and read the return value out of the response. The transaction is never signed and never submitted. Nothing is written to the ledger, nobody pays a fee, and no wallet prompt appears. Your entire read path works for logged-out visitors.

From `src/lib/stellar/action-log.ts`:

```ts
/** Simulate a read-only call and decode its return value to a native value. */
export async function simulateRead(
  target: Contract,
  method: string,
  args: xdr.ScVal[],
): Promise<unknown> {
  const source = new Account(actionLog.readSource, '0');
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: stellar.networkPassphrase,
  })
    .addOperation(target.call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await soroban.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(sim.error);
  }
  const retval = sim.result?.retval;
  return retval ? scValToNative(retval) : null;
}
```

`new Account(actionLog.readSource, '0')` is where the surprise lives. A transaction envelope structurally requires a source account, even one you will never submit. The sequence number `'0'` is a placeholder — irrelevant, because nothing is submitted — but the **account must be a real, funded account on the network** for simulation to proceed. Hence the dedicated `readSource` in the config, documented there as exactly that. Point it at an unfunded address and every read fails with an error that says nothing about the real cause.

`scValToNative` converts the host's `ScVal` return value into ordinary JavaScript. Be aware of the type mapping: Soroban `u64` and `i128` come back as `bigint`, not `number`. The repo normalises at the boundary rather than letting `bigint` leak into React state:

```ts
interface RawEntry {
  index: bigint | number;
  author: string;
  message: string;
  ledger: number;
  score: bigint | number;
}

function toEntry(raw: RawEntry): ActionEntry {
  return {
    index: Number(raw.index),
    author: raw.author,
    message: raw.message,
    ledger: Number(raw.ledger),
    score: Number(raw.score),
  };
}
```

The three reads the UI needs are then trivial. Note that `scoreOf` targets the *reputation* contract directly — from the client's point of view there is nothing special about a second contract:

```ts
/** Total number of actions recorded on-chain. */
export async function getCount(): Promise<number> {
  const value = await simulateRead(contract, 'get_count', []);
  return Number(value ?? 0);
}

/** The on-chain reputation score for an author (from the reputation contract). */
export async function scoreOf(author: string): Promise<number> {
  const value = await simulateRead(reputation, 'score_of', [
    Address.fromString(author).toScVal(),
  ]);
  return Number(value ?? 0);
}

/** The most recent entries, newest first. */
export async function getRecent(limit = 20): Promise<ActionEntry[]> {
  const value = await simulateRead(contract, 'get_recent', [
    nativeToScVal(limit, { type: 'u32' }),
  ]);
  if (!Array.isArray(value)) return [];
  return value.map((raw) => toEntry(raw as RawEntry));
}
```

`nativeToScVal(limit, { type: 'u32' })` — **always pass the explicit type**. A bare JavaScript number is ambiguous; the SDK cannot know whether your contract wants `u32`, `i32`, `u64` or `i128`, and guessing wrong produces a type-mismatch error from the host that reads as a generic simulation failure.

### 7.2 Writing: build, simulate, assemble

A write is a real transaction, and it has a step that classic Stellar payments do not.

```ts
/** Build an unsigned `record` invoke — simulated and assembled — as XDR. */
export async function buildRecordXdr(author: string, message: string): Promise<string> {
  const account = await soroban.getAccount(author);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: stellar.networkPassphrase,
  })
    .addOperation(
      contract.call(
        'record',
        Address.fromString(author).toScVal(),
        nativeToScVal(message, { type: 'string' }),
      ),
    )
    .setTimeout(60)
    .build();

  const sim = await soroban.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(sim.error);
  }
  return SorobanRpc.assembleTransaction(tx, sim).build().toXDR();
}
```

The sequence is: **fetch the real account** (a real sequence number this time — this transaction will be submitted), **build** the invocation, **simulate**, **assemble**, **return XDR**.

`assembleTransaction(tx, sim)` is the step you cannot skip. Simulation returns three things the transaction needs before it is valid: the **resource footprint** (exactly which ledger entries the invocation reads and writes), the **resource fee** (Soroban's compute/storage charge, on top of the base fee), and the **authorisation entries** the host derived from every `require_auth()` your call will hit. `assembleTransaction` folds all of that into the envelope. Submit an unassembled Soroban invocation and it is rejected — the network will not guess your footprint for you.

Simulating before signing has a second benefit: **contract errors surface before the wallet prompt**. An empty message trips `Error::EmptyMessage` during simulation, and the user sees a validation error instead of being asked to sign a transaction that was always going to fail.

Returning XDR rather than a transaction object is deliberate. XDR is the interchange format every Stellar wallet speaks, which is what makes the next step wallet-agnostic.

### 7.3 Signing with Stellar Wallets Kit

`src/lib/stellar/kit.ts` initialises the kit once, with six wallet modules:

```ts
import { Networks, StellarWalletsKit } from '@creit.tech/stellar-wallets-kit';
import {
  FreighterModule,
  FREIGHTER_ID,
} from '@creit.tech/stellar-wallets-kit/modules/freighter';
import { xBullModule } from '@creit.tech/stellar-wallets-kit/modules/xbull';
import { AlbedoModule } from '@creit.tech/stellar-wallets-kit/modules/albedo';
import { LobstrModule } from '@creit.tech/stellar-wallets-kit/modules/lobstr';
import { HanaModule } from '@creit.tech/stellar-wallets-kit/modules/hana';
import { RabetModule } from '@creit.tech/stellar-wallets-kit/modules/rabet';

let initialised = false;

export function getKit(): typeof StellarWalletsKit {
  if (typeof window === 'undefined') {
    throw new Error('Wallet kit is only available in the browser.');
  }
  if (!initialised) {
    StellarWalletsKit.init({
      network: Networks.TESTNET,
      selectedWalletId: FREIGHTER_ID,
      modules: [
        new FreighterModule(),
        new xBullModule(),
        new AlbedoModule(),
        new LobstrModule(),
        new HanaModule(),
        new RabetModule(),
      ],
    });
    initialised = true;
  }
  return StellarWalletsKit;
}
```

The `typeof window === 'undefined'` guard matters in any SSR framework — Next.js, Remix, SvelteKit. The kit reaches for browser globals at init, so it must not run on the server.

Signing itself, from `src/components/app/wallet-provider.tsx`:

```tsx
  const signTransaction = useCallback(
    async (xdr: string) => {
      if (!address) throw new Error('Connect your wallet first.');
      const { signedTxXdr } = await getKit().signTransaction(xdr, {
        address,
        networkPassphrase: stellar.networkPassphrase,
      });
      return signedTxXdr;
    },
    [address],
  );
```

XDR in, signed XDR out. Passing `networkPassphrase` explicitly is what makes a wallet on the wrong network fail loudly instead of producing a signature that the network will silently reject.

### 7.4 Submitting and polling

```ts
/** Submit a wallet-signed invoke XDR and wait for it to settle. Returns the hash. */
export async function submitInvoke(signedXdr: string): Promise<string> {
  const tx = TransactionBuilder.fromXDR(signedXdr, stellar.networkPassphrase);
  const sent = await soroban.sendTransaction(tx);
  if (sent.status === 'ERROR') {
    throw new Error('The network rejected the transaction.');
  }

  let got = await soroban.getTransaction(sent.hash);
  let tries = 0;
  while (got.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND && tries < 30) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    got = await soroban.getTransaction(sent.hash);
    tries += 1;
  }
  if (got.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error('The transaction did not succeed.');
  }
  return sent.hash;
}
```

**`sendTransaction` is asynchronous in the real sense.** It returns as soon as the transaction is accepted into the queue — that is `PENDING`, not "it worked". The result only exists once a ledger closes, roughly every 5 seconds. So you poll `getTransaction` until the status stops being `NOT_FOUND`.

`NOT_FOUND` is not an error; it means "no ledger has included this yet". The 30 × 1s bound is a timeout, not a promise the transaction failed — under an unusually slow ledger you might exit the loop while the transaction still lands. A production UI should therefore always surface the hash so the user can check an explorer regardless.

### 7.5 Wiring it into a component

`src/components/app/record-form.tsx` walks the phases explicitly. Trimmed to the submit handler:

```tsx
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!address) {
      setTx({ phase: 'error', message: 'Connect your wallet first.' });
      return;
    }

    if (!valid) {
      setTx({
        phase: 'error',
        message: 'Enter a message between 1 and 200 characters.',
      });
      return;
    }

    try {
      setTx({ phase: 'building' });
      const xdr = await buildRecordXdr(address, trimmed);

      setTx({ phase: 'signing' });
      const signed = await signTransaction(xdr);

      setTx({ phase: 'submitting' });
      const hash = await submitInvoke(signed);

      setTx({ phase: 'success', hash, message: 'Action recorded on-chain.' });
      setMessage('');
      onRecorded?.();
    } catch (err: unknown) {
      setTx({ phase: 'error', message: describeError(err) });
    }
  }
```

The phases are a shared type (`src/lib/stellar/types.ts`) so the lib and the UI cannot drift:

```ts
export type TxPhase =
  | 'idle'
  | 'building'
  | 'signing'
  | 'submitting'
  | 'success'
  | 'error';

export interface TxState {
  phase: TxPhase;
  /** Transaction hash, present once submitted (success or, sometimes, failure). */
  hash?: string;
  /** Human-readable status or error message. */
  message?: string;
}
```

Naming the phases separately is not ceremony. Each one can fail for a different reason and each takes a different amount of time — `building` is a network round trip, `signing` is a human decision with no upper bound, `submitting` is 5+ seconds of ledger time. A single `loading` boolean cannot tell a user whether the app is waiting on the chain or on them.

The `MAX = 200` in the form mirrors `MAX_MESSAGE_LEN` in the contract. Client-side validation is a courtesy so the user sees a character counter; the contract's check is the one that is actually enforced. Never remove the contract-side check because the UI has one.

---

## 8. Watching events

Reads give you a snapshot. Events give you the stream.

```ts
/** The current ledger sequence — the starting cursor for live events. */
export async function getLatestLedger(): Promise<number> {
  const { sequence } = await soroban.getLatestLedger();
  return sequence;
}

/** Fetch `recorded` events from `startLedger` onward for the live feed. */
export async function pollEvents(
  startLedger: number,
): Promise<{ entries: ActionEntry[]; latestLedger: number }> {
  const res = await soroban.getEvents({
    startLedger,
    filters: [{ type: 'contract', contractIds: [actionLog.contractId] }],
  });
  const entries = res.events.map((event) => toEntry(scValToNative(event.value) as RawEntry));
  return { entries, latestLedger: res.latestLedger };
}
```

`getEvents` is a **paged query over a ledger range**, not a subscription. There is no socket. You ask "what happened from ledger N onward", and the response includes `latestLedger` — the newest ledger the RPC has seen.

**That is your cursor, and keeping it is the whole trick.** Store `latestLedger + 1` and use it as the next `startLedger`. This is what makes polling correct rather than merely approximate:

- You never miss events, even if a poll is late or several ledgers close between ticks.
- You never re-fetch the same range, so you are not re-processing history every few seconds.
- The cursor survives tab focus loss, a slow network, or a paused laptop. On resume, one query catches up on everything missed.

The filter matches on contract id only, with no topic filter — this contract emits a single event type, so the filter would be redundant. If it emitted several, you would add a topic filter to avoid decoding events you do not care about.

`scValToNative(event.value)` decodes the event's data payload — which, because `Recorded` carries the entire entry, yields a complete `ActionEntry` with no follow-up read. This is where the redundancy from section 3.3 pays off.

The consuming component, `src/components/app/action-feed.tsx`, seeds from a read and then switches to events:

```tsx
const POLL_MS = 6000;
const MAX_SHOWN = 25;

  const seed = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [recent, total, latest] = await Promise.all([
        getRecent(20),
        getCount(),
        getLatestLedger(),
      ]);
      setEntries(recent);
      setCount(total);
      cursor.current = latest + 1;
    } catch {
      setError('Could not load the on-chain feed.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = setInterval(async () => {
      if (cursor.current == null) return;
      try {
        const { entries: incoming, latestLedger } = await pollEvents(cursor.current);
        merge(incoming);
        if (incoming.length > 0) {
          const highest = Math.max(...incoming.map((e) => e.index));
          setCount((c) => Math.max(c ?? 0, highest + 1));
        }
        cursor.current = latestLedger + 1;
      } catch {
        // no new ledger yet, or a transient RPC hiccup — retry next tick
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [merge]);
```

Three things to copy from this pattern:

**Seed with a read, then follow with events.** `getRecent` supplies history the event query cannot (see the retention gotcha below); `getEvents` supplies everything after the moment you started. Setting the cursor to `latest + 1` *at seed time* is what makes the seam clean — the read covers everything up to `latest`, events cover everything after.

**Deduplicate on merge.** A record you submit yourself appears twice: once when the form's `onRecorded` re-seeds the feed, once via the event poll. The merge keys on `entry.index`, which is unique by construction:

```tsx
  const merge = useCallback((incoming: ActionEntry[]) => {
    if (incoming.length === 0) return;
    setEntries((prev) => {
      const seen = new Set(prev.map((e) => e.index));
      const fresh = incoming.filter((e) => !seen.has(e.index));
      if (fresh.length === 0) return prev;
      return [...fresh, ...prev]
        .sort((a, b) => b.index - a.index)
        .slice(0, MAX_SHOWN);
    });
  }, []);
```

**Swallow poll errors, keep the interval alive.** A failed poll is normal — no new ledger, a transient RPC blip. The empty `catch` retries on the next tick rather than tearing down the feed. Note the cursor is *not* advanced on failure, so nothing is skipped.

A 6-second interval is chosen to track the ~5-second ledger close time. Polling faster spends RPC quota to learn nothing.

---

## 9. Gotchas

These are the ones that actually cost hours.

**`wasm32v1-none`, not `wasm32-unknown-unknown`.** Recent Stellar tooling builds to `wasm32v1-none`. Tutorials and Stack Overflow answers written before 2025 will tell you the older triple, and you will then go looking for a `.wasm` file in a directory that does not exist. `contracts/deploy.sh` names the real path: `zentra-action-log/target/wasm32v1-none/release/zentra_action_log.wasm`. If `stellar contract build` fails on a missing target, `rustup target add wasm32v1-none`.

**TTL and archival will kill an unattended contract.** Storage entries expire. Instance storage expiring archives the contract itself. A contract with `extend_ttl` calls in its write path stays alive only as long as it is being written to — nothing self-extends in the absence of traffic. If you need a contract to survive an idle month, plan for a keeper that periodically invokes it, and be aware that restoring archived state is possible but is extra work you did not plan for.

**Simulation needs a funded source account, even for reads.** This one is genuinely counter-intuitive: nothing is signed, nothing is submitted, nothing costs anything, and yet the source account in the envelope must exist and be funded on the network. That is why `src/config/contract.ts` carries a dedicated `readSource`. The failure mode is a simulation error that says nothing about accounts, so it is very hard to diagnose from the message alone.

**RPC and Horizon are different services with different jobs.** Soroban RPC (`https://soroban-testnet.stellar.org`) is the contract surface: simulate, assemble, submit invocations, `getEvents`. Horizon (`https://horizon-testnet.stellar.org`) is the classic surface: account balances, payments, operation history. This repo's architecture notes state the split plainly — the browser talks to RPC for contracts and Horizon for balances and payments. Sending a contract query to Horizon gets you a confusing 404 or an empty result rather than a helpful error.

**Event history is retention-limited.** RPC keeps recent event history — a rolling window, not the full chain. `getEvents` cannot rebuild a feed from genesis, and asking for a `startLedger` older than the retention window returns an error rather than a truncated result. Two consequences: seed your UI from a contract *read* rather than from events, and keep a floor for the oldest ledger you would ever query. This repo records one as `deployLedger: 3348158` in `src/config/contract.ts`, described there as "a floor for event history". If you need permanent history, index events into your own store as they arrive.

**Explicit ScVal types on every argument.** `nativeToScVal(limit, { type: 'u32' })`. Without the type hint the SDK guesses, and the resulting host type mismatch surfaces as a generic simulation failure with no mention of which argument was wrong.

**`bigint` at the boundary.** Soroban `u64`/`i128` decode to JavaScript `bigint`. Mixing `bigint` and `number` throws a `TypeError` at runtime, and `JSON.stringify` refuses to serialise `bigint` at all. Normalise at the decode boundary, as `toEntry` does, rather than discovering it three components deep.

**Freighter defaults to Mainnet.** Set it to Test Net before connecting. The symptom is a signature the network rejects, or a wallet that reports an account that does not exist.

**`mock_all_auths()` makes every auth test vacuous.** It is the right default for testing business logic and completely wrong for testing access control. Note that `rejects_unregistered_logger` in section 5.6 still passes *with* mocked auths — because the thing it tests is the registered-logger comparison, not the signature. That is a good illustration of why you need both layers: had the contract relied on `require_auth` alone, that test could not exist.

---

## 10. Where to go next

**Run it.** The board is live at <https://zentra-docs.vercel.app/board>. Connect a wallet on testnet, record a message, and watch it arrive in the feed a ledger later. The whole path in this tutorial — simulate the read, build the XDR, sign in the wallet, submit, poll, stream the event — is what happens when you press that button.

**Read the source.** <https://github.com/ALGOREX-PH/zentra-docs>

- `contracts/zentra-action-log/` — the contract and its tests
- `contracts/zentra-reputation/` — the cross-contract callee
- `contracts/deploy.sh` — the deployment workflow
- `src/lib/stellar/action-log.ts` — every client call in section 7
- `src/components/app/action-feed.tsx` — the event loop in section 8
- `.github/workflows/ci.yml` — contract tests plus a frontend job on every push

**Verify the deployment yourself.** The action log on Stellar Expert:
<https://stellar.expert/explorer/testnet/contract/CCSXFTQTWVSHUMH2C64RJKY7JKCVHD5REFIW3P3YPVY6PWHVSJ7ZDDES>

And the reputation contract it calls:
<https://stellar.expert/explorer/testnet/contract/CA2QOMGVQ5XWGFDYT5XEJ7EQ6B6H4ZNDAPS337P3BT55XY3DJY4AIIPI>

Find a `record` transaction and expand it: one transaction, two contracts, two events (`bumped` then `recorded`).

**Extensions worth attempting.** Add pagination to `get_recent` with an explicit offset argument, keeping the cap. Add an `Author(Address)` index so you can list one account's actions without scanning. Add a delete or edit path and think carefully about who is authorised. Each forces a design decision this tutorial made silently.

**Docs.** The full documentation site is at <https://zentra-docs.vercel.app/docs>.

---

*The action log described here is one piece of Zentra, a Stellar protocol for verifiable action receipts. The rest of the project — a zero-knowledge proof system and an on-chain verifier — is a separate concern and is not what this tutorial builds; if the idea of proving something about an action without revealing it is interesting, that work lives at <https://github.com/ALGOREX-PH/zentra-protocol>. Everything in this article, though, is plain Soroban: contract, tests, deployment, and a frontend, with no cryptography beyond what the network already does for you.*
