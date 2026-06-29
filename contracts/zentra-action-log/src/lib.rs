#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, vec, Address, Env, String,
    Vec,
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
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    EmptyMessage = 1,
    MessageTooLong = 2,
}

#[contract]
pub struct ActionLog;

#[contractimpl]
impl ActionLog {
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
        let entry = Entry {
            index,
            author: author.clone(),
            message: message.clone(),
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

        env.events().publish((symbol_short!("recorded"),), entry);

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
