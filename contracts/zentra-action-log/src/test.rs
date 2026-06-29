#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    Address, Env, String,
};

#[test]
fn records_and_counts() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(ActionLog, ());
    let client = ActionLogClient::new(&env, &id);
    let alice = Address::generate(&env);

    assert_eq!(client.get_count(), 0);

    let index = client.record(&alice, &String::from_str(&env, "gm stellar"));
    assert_eq!(index, 0);
    assert_eq!(client.get_count(), 1);

    let entry = client.get_entry(&0).unwrap();
    assert_eq!(entry.author, alice);
    assert_eq!(entry.message, String::from_str(&env, "gm stellar"));
}

#[test]
fn recent_is_newest_first() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(ActionLog, ());
    let client = ActionLogClient::new(&env, &id);
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
    let id = env.register(ActionLog, ());
    let client = ActionLogClient::new(&env, &id);
    let author = Address::generate(&env);

    let result = client.try_record(&author, &String::from_str(&env, ""));
    assert_eq!(result, Err(Ok(Error::EmptyMessage)));
    assert_eq!(client.get_count(), 0);
}

#[test]
fn emits_recorded_event() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(ActionLog, ());
    let client = ActionLogClient::new(&env, &id);
    let author = Address::generate(&env);

    client.record(&author, &String::from_str(&env, "hi"));
    assert_eq!(env.events().all().events().len(), 1);
}
