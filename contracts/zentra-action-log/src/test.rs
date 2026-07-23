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
fn emits_recorded_event() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);
    let author = Address::generate(&env);

    client.record(&author, &String::from_str(&env, "hi"));
    assert_eq!(env.events().all().events().len(), 1);
}
