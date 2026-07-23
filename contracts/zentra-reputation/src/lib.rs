#![no_std]
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Env,
};

const DAY_LEDGERS: u32 = 17_280; // ~1 day at 5s ledgers
const BUMP: u32 = 30 * DAY_LEDGERS;
const THRESHOLD: u32 = BUMP - DAY_LEDGERS;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Logger,
    Score(Address),
}

/// Emitted whenever an author's reputation is incremented.
#[contractevent(topics = ["bumped"])]
pub struct Bumped {
    pub author: Address,
    pub score: u32,
}

/// Emitted whenever the authorised logger is set or repointed.
///
/// A repoint silently breaks the action log that depends on this contract, so
/// it must not be an invisible admin action: this event puts every change on
/// the ledger where it can be watched and audited. See docs/SECURITY-REVIEW.md
/// ZEN-01.
#[contractevent(topics = ["logger_set"])]
pub struct LoggerSet {
    pub logger: Address,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    LoggerNotSet = 1,
    Unauthorized = 2,
}

#[contract]
pub struct Reputation;

#[contractimpl]
impl Reputation {
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
        LoggerSet { logger }.publish(&env);
    }

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

    /// The current reputation score for `author` (0 if never bumped).
    pub fn score_of(env: Env, author: Address) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::Score(author))
            .unwrap_or(0)
    }
}

mod test;
