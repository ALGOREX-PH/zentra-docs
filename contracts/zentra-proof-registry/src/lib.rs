#![no_std]
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, vec, Address, BytesN, Env,
    Vec,
};

const DAY_LEDGERS: u32 = 17_280; // ~1 day at 5s ledgers
const INSTANCE_BUMP: u32 = 30 * DAY_LEDGERS;
const INSTANCE_THRESHOLD: u32 = INSTANCE_BUMP - DAY_LEDGERS;
const ENTRY_BUMP: u32 = 90 * DAY_LEDGERS;
const ENTRY_THRESHOLD: u32 = ENTRY_BUMP - DAY_LEDGERS;
const MAX_RECENT: u32 = 20;
/// Upper bound on a proof's public signal count. The current payment-policy
/// circuit exposes 14 public signals; 64 leaves generous headroom for future
/// circuits while still rejecting obviously-corrupt values a buggy client
/// might send.
const MAX_SIGNALS: u32 = 64;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Count,
    Entry(u64),
}

/// One anchored proof: who, the proof commitment, the public signal count, and
/// when (by ledger).
#[contracttype]
#[derive(Clone)]
pub struct Entry {
    pub index: u64,
    pub prover: Address,
    pub commitment: BytesN<32>,
    pub signals: u32,
    pub ledger: u32,
}

/// Emitted whenever a proof is anchored — the frontend streams these for the
/// live feed (topic `anchored`, data carries the full entry).
#[contractevent(topics = ["anchored"])]
pub struct Anchored {
    pub index: u64,
    pub prover: Address,
    pub commitment: BytesN<32>,
    pub signals: u32,
    pub ledger: u32,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NoSignals = 1,
    TooManySignals = 2,
    CounterOverflow = 3,
}

#[contract]
pub struct ProofRegistry;

#[contractimpl]
impl ProofRegistry {
    /// Anchor a proof committed to by `prover`. Stores it, bumps the global
    /// count, emits an `anchored` event, and returns the new entry's index.
    ///
    /// Duplicate commitments are accepted by design: a commitment is a claim,
    /// not a proof, and the same commitment may legitimately be anchored more
    /// than once (re-anchoring after a wallet switch, or two provers claiming
    /// the same public signals). Consumers that need uniqueness dedupe
    /// off-chain.
    pub fn anchor(
        env: Env,
        prover: Address,
        commitment: BytesN<32>,
        signals: u32,
    ) -> Result<u64, Error> {
        prover.require_auth();

        if signals == 0 {
            return Err(Error::NoSignals);
        }
        if signals > MAX_SIGNALS {
            return Err(Error::TooManySignals);
        }

        let index: u64 = env.storage().instance().get(&DataKey::Count).unwrap_or(0);
        // Wrapping the counter would let a new entry overwrite an old one, so
        // overflow is a hard error rather than a silent wrap.
        let next = index.checked_add(1).ok_or(Error::CounterOverflow)?;

        let entry = Entry {
            index,
            prover: prover.clone(),
            commitment: commitment.clone(),
            signals,
            ledger: env.ledger().sequence(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Entry(index), &entry);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Entry(index), ENTRY_THRESHOLD, ENTRY_BUMP);

        env.storage().instance().set(&DataKey::Count, &next);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_BUMP);

        Anchored {
            index,
            prover,
            commitment,
            signals,
            ledger: entry.ledger,
        }
        .publish(&env);

        Ok(index)
    }

    /// Total number of proofs anchored.
    pub fn get_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::Count).unwrap_or(0)
    }

    /// Fetch a single entry by index, if it exists.
    pub fn get_entry(env: Env, index: u64) -> Option<Entry> {
        env.storage().persistent().get(&DataKey::Entry(index))
    }

    /// The most recent entries, newest first (capped at `MAX_RECENT` to bound
    /// the read).
    pub fn get_recent(env: Env, limit: u32) -> Vec<Entry> {
        let count: u64 = env.storage().instance().get(&DataKey::Count).unwrap_or(0);
        let mut out: Vec<Entry> = vec![&env];
        let capped = limit.min(MAX_RECENT);
        if count == 0 || capped == 0 {
            return out;
        }

        let mut i: u64 = count;
        let mut taken: u32 = 0;
        while i > 0 && taken < capped {
            i -= 1;
            let entry: Option<Entry> = env.storage().persistent().get(&DataKey::Entry(i));
            // The None arm is defensive: entries are never deleted (an archived entry traps rather than reading None).
            if let Some(entry) = entry {
                out.push_back(entry);
                taken += 1;
            }
        }
        out
    }
}

mod test;
