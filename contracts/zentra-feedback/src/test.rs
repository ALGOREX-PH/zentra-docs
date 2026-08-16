#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    Address, Env, InvokeError, String,
};

fn client(env: &Env) -> FeedbackClient<'_> {
    let id = env.register(Feedback, ());
    FeedbackClient::new(env, &id)
}

#[test]
fn submits_and_summarizes() {
    let env = Env::default();
    env.mock_all_auths();
    let client = client(&env);
    let author = Address::generate(&env);

    client.submit(&author, &5, &String::from_str(&env, "love it"));
    client.submit(&author, &3, &String::from_str(&env, "could be better"));

    assert_eq!(client.get_count(), 2);
    assert_eq!(client.summary(), (2, 8));

    let recent = client.get_recent(&2);
    assert_eq!(recent.len(), 2);
    assert_eq!(
        recent.get(0).unwrap().comment,
        String::from_str(&env, "could be better")
    );
    assert_eq!(
        recent.get(1).unwrap().comment,
        String::from_str(&env, "love it")
    );
}

#[test]
fn recent_returns_min_of_limit_and_count() {
    let env = Env::default();
    env.mock_all_auths();
    let client = client(&env);
    let author = Address::generate(&env);

    client.submit(&author, &5, &String::from_str(&env, "one"));
    client.submit(&author, &4, &String::from_str(&env, "two"));
    client.submit(&author, &3, &String::from_str(&env, "three"));

    assert_eq!(client.get_recent(&2).len(), 2);
    assert_eq!(client.get_recent(&3).len(), 3);
    assert_eq!(client.get_recent(&10).len(), 3);
    assert_eq!(client.get_recent(&0).len(), 0);
}

#[test]
fn recent_limit_clamps_to_max() {
    let env = Env::default();
    env.mock_all_auths();
    let client = client(&env);
    let author = Address::generate(&env);

    for _ in 0..(MAX_RECENT + 5) {
        client.submit(&author, &5, &String::from_str(&env, "entry"));
    }

    let recent = client.get_recent(&50);
    assert_eq!(recent.len(), MAX_RECENT);
    assert_eq!(recent.get(0).unwrap().index, (MAX_RECENT + 4) as u64);
}

#[test]
fn recent_skipped_entries_do_not_count_toward_limit() {
    let env = Env::default();
    env.mock_all_auths();
    let client = client(&env);
    let author = Address::generate(&env);

    client.submit(&author, &5, &String::from_str(&env, "one"));
    client.submit(&author, &4, &String::from_str(&env, "two"));
    client.submit(&author, &3, &String::from_str(&env, "three"));

    // Simulate the defensive None arm: punch a hole in storage and make sure a
    // skipped entry does not eat a slot of the requested limit.
    env.as_contract(&client.address, || {
        env.storage().persistent().remove(&DataKey::Entry(1));
    });

    let recent = client.get_recent(&2);
    assert_eq!(recent.len(), 2);
    assert_eq!(
        recent.get(0).unwrap().comment,
        String::from_str(&env, "three")
    );
    assert_eq!(
        recent.get(1).unwrap().comment,
        String::from_str(&env, "one")
    );
}

#[test]
fn rejects_bad_rating() {
    let env = Env::default();
    env.mock_all_auths();
    let client = client(&env);
    let author = Address::generate(&env);

    assert_eq!(
        client.try_submit(&author, &6, &String::from_str(&env, "x")),
        Err(Ok(Error::InvalidRating))
    );
    assert_eq!(
        client.try_submit(&author, &0, &String::from_str(&env, "x")),
        Err(Ok(Error::InvalidRating))
    );
}

#[test]
fn rejects_empty_comment() {
    let env = Env::default();
    env.mock_all_auths();
    let client = client(&env);
    let author = Address::generate(&env);

    assert_eq!(
        client.try_submit(&author, &5, &String::from_str(&env, "")),
        Err(Ok(Error::EmptyComment))
    );
}

#[test]
fn submit_requires_author_authorization() {
    let env = Env::default();
    let client = client(&env);
    let author = Address::generate(&env);

    assert_eq!(
        client.try_submit(&author, &5, &String::from_str(&env, "valid feedback")),
        Err(Err(InvokeError::Abort)),
    );
}

#[test]
fn emits_feedback_event() {
    let env = Env::default();
    env.mock_all_auths();
    let client = client(&env);
    let author = Address::generate(&env);

    client.submit(&author, &5, &String::from_str(&env, "hi"));
    assert_eq!(env.events().all().events().len(), 1);
}
