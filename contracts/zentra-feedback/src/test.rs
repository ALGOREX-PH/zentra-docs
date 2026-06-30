#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    Address, Env, String,
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
    assert_eq!(recent.get(1).unwrap().comment, String::from_str(&env, "love it"));
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
fn emits_feedback_event() {
    let env = Env::default();
    env.mock_all_auths();
    let client = client(&env);
    let author = Address::generate(&env);

    client.submit(&author, &5, &String::from_str(&env, "hi"));
    assert_eq!(env.events().all().events().len(), 1);
}
