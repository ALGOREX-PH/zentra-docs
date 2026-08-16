#![no_std]
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, vec, Address, Env, String,
    Vec,
};

const DAY_LEDGERS: u32 = 17_280; // ~1 day at 5s ledgers
const INSTANCE_BUMP: u32 = 30 * DAY_LEDGERS;
const INSTANCE_THRESHOLD: u32 = INSTANCE_BUMP - DAY_LEDGERS;
const ENTRY_BUMP: u32 = 90 * DAY_LEDGERS;
const ENTRY_THRESHOLD: u32 = ENTRY_BUMP - DAY_LEDGERS;
const MAX_COMMENT_LEN: u32 = 280;
const MAX_RECENT: u32 = 20;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Count,
    RatingSum,
    Entry(u64),
}

/// One piece of feedback: who, the rating, the comment, and when (by ledger).
#[contracttype]
#[derive(Clone)]
pub struct Entry {
    pub index: u64,
    pub author: Address,
    pub rating: u32,
    pub comment: String,
    pub ledger: u32,
}

/// Aggregate feedback state: the entry count paired with the running rating
/// sum. A named struct rather than a bare tuple so the contract spec is
/// self-describing — clients decode fields by name, not by position.
#[contracttype]
#[derive(Clone)]
pub struct Summary {
    pub count: u64,
    pub rating_sum: u64,
}

/// Emitted whenever feedback is submitted — the frontend streams these for the
/// live feed (topic `submitted`, data carries the full entry).
#[contractevent(topics = ["submitted"])]
pub struct Submitted {
    pub index: u64,
    pub author: Address,
    pub rating: u32,
    pub comment: String,
    pub ledger: u32,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    InvalidRating = 1,
    EmptyComment = 2,
    CommentTooLong = 3,
    CounterOverflow = 4,
}

#[contract]
pub struct Feedback;

#[contractimpl]
impl Feedback {
    /// Submit feedback authored by `author`. Stores it, bumps the global count,
    /// folds the rating into the running sum, emits a `submitted` event, and
    /// returns the new entry's index.
    pub fn submit(env: Env, author: Address, rating: u32, comment: String) -> Result<u64, Error> {
        author.require_auth();

        if !(1..=5).contains(&rating) {
            return Err(Error::InvalidRating);
        }

        let len = comment.len();
        if len == 0 {
            return Err(Error::EmptyComment);
        }
        if len > MAX_COMMENT_LEN {
            return Err(Error::CommentTooLong);
        }

        let index: u64 = env.storage().instance().get(&DataKey::Count).unwrap_or(0);
        // Wrapping either accumulator would corrupt history — a wrapped counter
        // lets a new entry overwrite an old one, a wrapped rating sum falsifies
        // the average — so overflow is a hard error rather than a silent wrap.
        let next = index.checked_add(1).ok_or(Error::CounterOverflow)?;
        let sum: u64 = env
            .storage()
            .instance()
            .get(&DataKey::RatingSum)
            .unwrap_or(0u64)
            .checked_add(rating as u64)
            .ok_or(Error::CounterOverflow)?;

        let entry = Entry {
            index,
            author: author.clone(),
            rating,
            comment: comment.clone(),
            ledger: env.ledger().sequence(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Entry(index), &entry);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Entry(index), ENTRY_THRESHOLD, ENTRY_BUMP);

        env.storage().instance().set(&DataKey::Count, &next);
        env.storage().instance().set(&DataKey::RatingSum, &sum);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_BUMP);

        Submitted {
            index,
            author,
            rating,
            comment,
            ledger: entry.ledger,
        }
        .publish(&env);

        Ok(index)
    }

    /// Total number of feedback entries submitted.
    pub fn get_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::Count).unwrap_or(0)
    }

    /// Fetch a single entry by index, if it exists.
    pub fn get_entry(env: Env, index: u64) -> Option<Entry> {
        env.storage().persistent().get(&DataKey::Entry(index))
    }

    /// The entry count paired with the running rating sum; the frontend divides
    /// these to show the average.
    pub fn summary(env: Env) -> Summary {
        let count: u64 = env.storage().instance().get(&DataKey::Count).unwrap_or(0);
        let rating_sum: u64 = env
            .storage()
            .instance()
            .get(&DataKey::RatingSum)
            .unwrap_or(0);
        Summary { count, rating_sum }
    }

    /// The most recent entries, newest first (capped at 20 to bound the read).
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
