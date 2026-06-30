#![no_std]
use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, vec, Address, BytesN, Env, Vec,
};

const DAY_LEDGERS: u32 = 17_280; // ~1 day at 5s ledgers
const INSTANCE_BUMP: u32 = 30 * DAY_LEDGERS;
const INSTANCE_THRESHOLD: u32 = INSTANCE_BUMP - DAY_LEDGERS;
const ENTRY_BUMP: u32 = 90 * DAY_LEDGERS;
const ENTRY_THRESHOLD: u32 = ENTRY_BUMP - DAY_LEDGERS;
const MAX_RECENT: u32 = 20;

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
/// live feed (topic `anchored`).
#[contractevent(topics = ["anchored"])]
pub struct Anchored {
    pub index: u64,
    pub prover: Address,
    pub commitment: BytesN<32>,
}

#[contract]
pub struct ProofRegistry;

#[contractimpl]
impl ProofRegistry {
    /// Anchor a proof committed to by `prover`. Stores it, bumps the global
    /// count, emits an `anchored` event, and returns the new entry's index.
    pub fn anchor(env: Env, prover: Address, commitment: BytesN<32>, signals: u32) -> u64 {
        prover.require_auth();

        let index: u64 = env.storage().instance().get(&DataKey::Count).unwrap_or(0);

        let entry = Entry {
            index,
            prover: prover.clone(),
            commitment: commitment.clone(),
            signals,
            ledger: env.ledger().sequence(),
        };

        env.storage().persistent().set(&DataKey::Entry(index), &entry);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Entry(index), ENTRY_THRESHOLD, ENTRY_BUMP);

        env.storage().instance().set(&DataKey::Count, &(index + 1));
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_BUMP);

        Anchored {
            index,
            prover,
            commitment,
        }
        .publish(&env);

        index
    }

    /// Total number of proofs anchored.
    pub fn get_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::Count).unwrap_or(0)
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
}

mod test;
