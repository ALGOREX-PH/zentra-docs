#![cfg(test)]
use super::*;
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Events as _},
    vec,
    xdr::{ScErrorCode, ScErrorType},
    Address, Env, Error as SdkError, Event as _, InvokeError, String,
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

// Mirrors the authorization boundary of the real reputation contract so the
// action log's cross-contract dependency can be negatively tested in isolation.
#[contract]
pub struct AuthenticatedReputation;

#[contractimpl]
impl AuthenticatedReputation {
    pub fn bump(_env: Env, logger: Address, _author: Address) -> u32 {
        logger.require_auth();
        1
    }
}

// A reputation stand-in that always rejects, standing in for the case where the
// reputation admin has repointed its authorised logger away from this action
// log. Every `bump` traps, exactly as the real contract's `Unauthorized` does.
#[contract]
pub struct RejectingReputation;

#[contractimpl]
impl RejectingReputation {
    pub fn bump(_env: Env, _logger: Address, _author: Address) -> u32 {
        panic!("not the registered logger");
    }
}

fn setup(env: &Env) -> ActionLogClient<'_> {
    let reputation = env.register(MockReputation, ());
    let id = env.register(ActionLog, (reputation,));
    ActionLogClient::new(env, &id)
}

#[test]
fn record_rejects_missing_author_authorization() {
    let env = Env::default();
    let client = setup(&env);
    let author = Address::generate(&env);

    let result = client.try_record(&author, &String::from_str(&env, "valid message"));

    assert_eq!(result, Err(Err(InvokeError::Abort)));
    assert_eq!(client.get_count(), 0);
}

#[test]
fn reputation_bump_rejects_missing_logger_authorization() {
    let env = Env::default();
    let reputation = env.register(AuthenticatedReputation, ());
    let client = AuthenticatedReputationClient::new(&env, &reputation);
    let logger = Address::generate(&env);
    let author = Address::generate(&env);

    let result = client.try_bump(&logger, &author);

    assert_eq!(
        result,
        Err(Ok(SdkError::from_type_and_code(
            ScErrorType::Context,
            ScErrorCode::InvalidAction,
        )))
    );
}

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

#[test]
fn record_degrades_when_reputation_rejects() {
    let env = Env::default();
    env.mock_all_auths();
    let reputation = env.register(RejectingReputation, ());
    let id = env.register(ActionLog, (reputation,));
    let client = ActionLogClient::new(&env, &id);
    let author = Address::generate(&env);

    // The cross-contract bump traps, but the action must still be recorded —
    // with a degraded score of 0 — rather than the whole call trapping. This is
    // the ZEN-01 fix: a broken reputation pointer cannot brick `record`.
    let index = client.record(&author, &String::from_str(&env, "still logged"));
    assert_eq!(index, 0);
    assert_eq!(client.get_count(), 1);
    assert_eq!(client.get_entry(&0).unwrap().score, 0);
}

#[test]
fn accepts_max_length_message_and_rejects_one_over() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);
    let author = Address::generate(&env);

    // The budget is bytes (UTF-8): exactly MAX_MESSAGE_BYTES is accepted, one
    // more byte is rejected.
    let max = [b'a'; MAX_MESSAGE_BYTES as usize];
    let over = [b'a'; MAX_MESSAGE_BYTES as usize + 1];
    let max_msg = String::from_str(&env, core::str::from_utf8(&max).unwrap());
    let over_msg = String::from_str(&env, core::str::from_utf8(&over).unwrap());

    assert_eq!(client.record(&author, &max_msg), 0);
    assert_eq!(
        client.try_record(&author, &over_msg),
        Err(Ok(Error::MessageTooLong))
    );
    assert_eq!(client.get_count(), 1);
}

#[test]
fn get_entry_returns_none_for_missing_index() {
    let env = Env::default();
    let client = setup(&env);

    // `Entry` is not `Debug`/`PartialEq` (house style keeps `contracttype`
    // structs to `Clone`), so the missing case is matched rather than compared.
    assert!(client.get_entry(&99).is_none());
}

// Integration against the REAL reputation crate rather than a mock: wire both
// contracts the way deploy.sh does and prove the cross-contract bump lands.
#[test]
fn records_against_real_reputation_contract() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let reputation_id = env.register(zentra_reputation::Reputation, (admin,));
    let log_id = env.register(ActionLog, (reputation_id.clone(),));
    let client = ActionLogClient::new(&env, &log_id);
    let reputation = zentra_reputation::ReputationClient::new(&env, &reputation_id);

    // Authorize the log as the reputation's registered logger, as deploy.sh does.
    reputation.set_logger(&log_id);

    let author = Address::generate(&env);
    client.record(&author, &String::from_str(&env, "real bump"));
    assert_eq!(client.get_entry(&0).unwrap().score, 1);
    assert_eq!(reputation.score_of(&author), 1);

    client.record(&author, &String::from_str(&env, "again"));
    assert_eq!(client.get_entry(&1).unwrap().score, 2);
    assert_eq!(reputation.score_of(&author), 2);
}

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
    assert_eq!(
        recent.get(0).unwrap().message,
        String::from_str(&env, "three")
    );
    assert_eq!(
        recent.get(1).unwrap().message,
        String::from_str(&env, "two")
    );
}

#[test]
fn recent_returns_min_of_limit_and_count() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);
    let author = Address::generate(&env);

    client.record(&author, &String::from_str(&env, "one"));
    client.record(&author, &String::from_str(&env, "two"));
    client.record(&author, &String::from_str(&env, "three"));

    assert_eq!(client.get_recent(&2).len(), 2);
    assert_eq!(client.get_recent(&3).len(), 3);
    assert_eq!(client.get_recent(&10).len(), 3);
    assert_eq!(client.get_recent(&0).len(), 0);
}

#[test]
fn recent_limit_clamps_to_max() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);
    let author = Address::generate(&env);

    for _ in 0..(MAX_RECENT + 5) {
        client.record(&author, &String::from_str(&env, "entry"));
    }

    let recent = client.get_recent(&50);
    assert_eq!(recent.len(), MAX_RECENT);
    assert_eq!(recent.get(0).unwrap().index, (MAX_RECENT + 4) as u64);
}

#[test]
fn recent_skipped_entries_do_not_count_toward_limit() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);
    let author = Address::generate(&env);

    client.record(&author, &String::from_str(&env, "one"));
    client.record(&author, &String::from_str(&env, "two"));
    client.record(&author, &String::from_str(&env, "three"));

    // Simulate the defensive None arm: punch a hole in storage and make sure a
    // skipped entry does not eat a slot of the requested limit.
    env.as_contract(&client.address, || {
        env.storage().persistent().remove(&DataKey::Entry(1));
    });

    let recent = client.get_recent(&2);
    assert_eq!(recent.len(), 2);
    assert_eq!(
        recent.get(0).unwrap().message,
        String::from_str(&env, "three")
    );
    assert_eq!(
        recent.get(1).unwrap().message,
        String::from_str(&env, "one")
    );
}

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

#[test]
fn record_rejects_counter_overflow() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);
    let author = Address::generate(&env);

    // Seed the counter at its ceiling; the next record must fail with a typed
    // error rather than wrap and overwrite entry 0.
    env.as_contract(&client.address, || {
        env.storage().instance().set(&DataKey::Count, &u64::MAX);
    });

    assert_eq!(
        client.try_record(&author, &String::from_str(&env, "one too many")),
        Err(Ok(Error::CounterOverflow))
    );
    assert_eq!(client.get_count(), u64::MAX);
}

#[test]
fn emits_recorded_event() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);
    let author = Address::generate(&env);

    client.record(&author, &String::from_str(&env, "hi"));
    let recorded = Recorded {
        index: 0,
        author: author.clone(),
        message: String::from_str(&env, "hi"),
        ledger: env.ledger().sequence(),
        score: 1,
    };
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                client.address.clone(),
                recorded.topics(&env),
                recorded.data(&env)
            )
        ]
    );
}

// Pins the hand-maintained `ReputationError` mirror to the real reputation
// contract's `Error`: if a variant code drifts over there, this fails here.
#[test]
fn reputation_error_mirror_matches_real_contract() {
    assert_eq!(
        ReputationError::LoggerNotSet as u32,
        zentra_reputation::Error::LoggerNotSet as u32
    );
    assert_eq!(
        ReputationError::Unauthorized as u32,
        zentra_reputation::Error::Unauthorized as u32
    );
    assert_eq!(
        ReputationError::ScoreOverflow as u32,
        zentra_reputation::Error::ScoreOverflow as u32
    );
}
