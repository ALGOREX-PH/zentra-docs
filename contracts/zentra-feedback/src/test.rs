#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    vec, Address, Env, Event as _, InvokeError, String,
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
    let summary = client.summary();
    assert_eq!(summary.count, 2);
    assert_eq!(summary.rating_sum, 8);

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
fn summary_is_zero_before_any_submission() {
    let env = Env::default();
    let client = client(&env);

    let summary = client.summary();
    assert_eq!(summary.count, 0);
    assert_eq!(summary.rating_sum, 0);
}

#[test]
fn gets_entry_by_index() {
    let env = Env::default();
    env.mock_all_auths();
    let client = client(&env);
    let author = Address::generate(&env);

    client.submit(&author, &4, &String::from_str(&env, "solid"));

    let entry = client.get_entry(&0).unwrap();
    assert_eq!(entry.index, 0);
    assert_eq!(entry.author, author);
    assert_eq!(entry.rating, 4);
    assert_eq!(entry.comment, String::from_str(&env, "solid"));
}

#[test]
fn get_entry_returns_none_for_missing_index() {
    let env = Env::default();
    let client = client(&env);

    // `Entry` is not `Debug`/`PartialEq` (house style keeps `contracttype`
    // structs to `Clone`), so the missing case is matched rather than compared.
    assert!(client.get_entry(&99).is_none());
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
fn accepts_max_length_comment_and_rejects_one_over() {
    let env = Env::default();
    env.mock_all_auths();
    let client = client(&env);
    let author = Address::generate(&env);

    // The budget is bytes (UTF-8): exactly MAX_COMMENT_BYTES is accepted, one
    // more byte is rejected.
    let max = [b'a'; MAX_COMMENT_BYTES as usize];
    let over = [b'a'; MAX_COMMENT_BYTES as usize + 1];
    let max_comment = String::from_str(&env, core::str::from_utf8(&max).unwrap());
    let over_comment = String::from_str(&env, core::str::from_utf8(&over).unwrap());

    assert_eq!(client.submit(&author, &5, &max_comment), 0);
    assert_eq!(
        client.try_submit(&author, &5, &over_comment),
        Err(Ok(Error::CommentTooLong))
    );
    assert_eq!(client.get_count(), 1);
}

#[test]
fn accepts_lowest_valid_rating() {
    let env = Env::default();
    env.mock_all_auths();
    let client = client(&env);
    let author = Address::generate(&env);

    // rating == 1 is the lower bound of the valid 1..=5 range, not a rejection.
    assert_eq!(
        client.submit(&author, &1, &String::from_str(&env, "meh")),
        0
    );
    assert_eq!(client.get_entry(&0).unwrap().rating, 1);
    let summary = client.summary();
    assert_eq!(summary.count, 1);
    assert_eq!(summary.rating_sum, 1);
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
fn submit_rejects_counter_overflow() {
    let env = Env::default();
    env.mock_all_auths();
    let client = client(&env);
    let author = Address::generate(&env);

    // Seed the counter at its ceiling; the next submit must fail with a typed
    // error rather than wrap and overwrite entry 0.
    env.as_contract(&client.address, || {
        env.storage().instance().set(&DataKey::Count, &u64::MAX);
    });

    assert_eq!(
        client.try_submit(&author, &5, &String::from_str(&env, "one too many")),
        Err(Ok(Error::CounterOverflow))
    );
    assert_eq!(client.get_count(), u64::MAX);
}

#[test]
fn submit_rejects_rating_sum_overflow() {
    let env = Env::default();
    env.mock_all_auths();
    let client = client(&env);
    let author = Address::generate(&env);

    // A wrapped rating sum would falsify the average silently.
    env.as_contract(&client.address, || {
        env.storage().instance().set(&DataKey::RatingSum, &u64::MAX);
    });

    assert_eq!(
        client.try_submit(&author, &5, &String::from_str(&env, "x")),
        Err(Ok(Error::CounterOverflow))
    );
    assert_eq!(client.summary().rating_sum, u64::MAX);
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
fn emits_submitted_event() {
    let env = Env::default();
    env.mock_all_auths();
    let client = client(&env);
    let author = Address::generate(&env);

    client.submit(&author, &5, &String::from_str(&env, "hi"));
    let submitted = Submitted {
        index: 0,
        author: author.clone(),
        rating: 5,
        comment: String::from_str(&env, "hi"),
        ledger: env.ledger().sequence(),
    };
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                client.address.clone(),
                submitted.topics(&env),
                submitted.data(&env)
            )
        ]
    );
}
