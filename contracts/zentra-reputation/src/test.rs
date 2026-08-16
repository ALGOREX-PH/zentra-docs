#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{storage::Persistent as _, Address as _, Events as _},
    vec,
    xdr::{ScErrorCode, ScErrorType},
    Address, Env, Event as _, InvokeError,
};

fn deploy(env: &Env) -> (ReputationClient<'_>, Address) {
    let admin = Address::generate(env);
    let id = env.register(Reputation, (admin.clone(),));
    (ReputationClient::new(env, &id), admin)
}

#[test]
fn bumps_and_reads_score() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = deploy(&env);

    let logger = Address::generate(&env);
    client.set_logger(&logger);

    let author = Address::generate(&env);
    assert_eq!(client.score_of(&author), 0);
    assert_eq!(client.bump(&logger, &author), 1);
    assert_eq!(client.bump(&logger, &author), 2);
    assert_eq!(client.score_of(&author), 2);
}

#[test]
fn rejects_bump_before_logger_is_set() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = deploy(&env);

    let logger = Address::generate(&env);
    let author = Address::generate(&env);
    assert_eq!(
        client.try_bump(&logger, &author),
        Err(Ok(Error::LoggerNotSet)),
    );
    assert_eq!(client.score_of(&author), 0);
}

#[test]
fn repointing_logger_locks_out_old_logger_and_keeps_scores() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = deploy(&env);

    let old_logger = Address::generate(&env);
    client.set_logger(&old_logger);
    let author = Address::generate(&env);
    client.bump(&old_logger, &author);
    assert_eq!(client.score_of(&author), 1);

    // Repoint: the old logger is locked out, but accumulated scores survive
    // and the new logger continues the same tally. ZEN-01.
    let new_logger = Address::generate(&env);
    client.set_logger(&new_logger);
    assert_eq!(
        client.try_bump(&old_logger, &author),
        Err(Ok(Error::Unauthorized)),
    );
    assert_eq!(client.score_of(&author), 1);
    assert_eq!(client.bump(&new_logger, &author), 2);
}

#[test]
fn rejects_unregistered_logger() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = deploy(&env);

    let logger = Address::generate(&env);
    client.set_logger(&logger);

    let imposter = Address::generate(&env);
    let author = Address::generate(&env);
    assert_eq!(
        client.try_bump(&imposter, &author),
        Err(Ok(Error::Unauthorized)),
    );
}

#[test]
fn emits_bumped_event() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = deploy(&env);

    let logger = Address::generate(&env);
    client.set_logger(&logger);
    let author = Address::generate(&env);
    client.bump(&logger, &author);

    let bumped = Bumped {
        author: author.clone(),
        score: 1,
    };
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                client.address.clone(),
                bumped.topics(&env),
                bumped.data(&env)
            )
        ]
    );
}

#[test]
fn set_logger_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = deploy(&env);

    // A repoint is a security-relevant admin action, so it must be observable
    // on the ledger rather than a silent state change. ZEN-01.
    let logger = Address::generate(&env);
    client.set_logger(&logger);

    let logger_set = LoggerSet {
        logger: logger.clone(),
    };
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                client.address.clone(),
                logger_set.topics(&env),
                logger_set.data(&env)
            )
        ]
    );
}

#[test]
fn bump_extends_score_ttl_to_entry_bump() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = deploy(&env);

    let logger = Address::generate(&env);
    client.set_logger(&logger);
    let author = Address::generate(&env);
    client.bump(&logger, &author);

    // The score must live as long as the 90-day Action Log entries that embed
    // it, not the 30-day instance bump.
    let ttl = env.as_contract(&client.address, || {
        env.storage()
            .persistent()
            .get_ttl(&DataKey::Score(author.clone()))
    });
    assert_eq!(ttl, ENTRY_BUMP);
}

#[test]
fn bump_rejects_score_overflow() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = deploy(&env);

    let logger = Address::generate(&env);
    client.set_logger(&logger);
    let author = Address::generate(&env);

    // Seed the score at its ceiling; the next bump must fail with a typed
    // error rather than wrap the author back to zero.
    env.as_contract(&client.address, || {
        env.storage()
            .persistent()
            .set(&DataKey::Score(author.clone()), &u32::MAX);
    });

    assert_eq!(
        client.try_bump(&logger, &author),
        Err(Ok(Error::ScoreOverflow))
    );
    assert_eq!(client.score_of(&author), u32::MAX);
}

#[test]
fn bump_requires_logger_authorization() {
    let env = Env::default();
    let (client, _admin) = deploy(&env);

    let logger = Address::generate(&env);
    let author = Address::generate(&env);

    assert_eq!(
        client.try_bump(&logger, &author),
        Err(Err(InvokeError::Abort)),
    );
}

#[test]
fn set_logger_requires_admin_authorization() {
    let env = Env::default();
    let (client, _admin) = deploy(&env);

    let logger = Address::generate(&env);

    assert_eq!(
        client.try_set_logger(&logger),
        Err(Ok((ScErrorType::Context, ScErrorCode::InvalidAction).into())),
    );
}
