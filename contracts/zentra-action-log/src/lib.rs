#![no_std]
use soroban_sdk::{
    contract, contractclient, contractevent, contracterror, contractimpl, contracttype, vec,
    Address, Env, String, Vec,
};

const DAY_LEDGERS: u32 = 17_280; // ~1 day at 5s ledgers
const INSTANCE_BUMP: u32 = 30 * DAY_LEDGERS;
const INSTANCE_THRESHOLD: u32 = INSTANCE_BUMP - DAY_LEDGERS;
const ENTRY_BUMP: u32 = 90 * DAY_LEDGERS;
const ENTRY_THRESHOLD: u32 = ENTRY_BUMP - DAY_LEDGERS;
const MAX_MESSAGE_LEN: u32 = 200;
const MAX_RECENT: u32 = 20;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Count,
    Reputation,
    Entry(u64),
}

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

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    EmptyMessage = 1,
    MessageTooLong = 2,
}

/// The slice of the Reputation contract this log calls cross-contract.
#[contractclient(name = "ReputationClient")]
pub trait Reputation {
    fn bump(env: Env, logger: Address, author: Address) -> u32;
}

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
}

mod test;
