#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    Address, Env,
};

fn deploy(env: &Env) -> (ReputationClient, Address) {
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

    assert_eq!(env.events().all().events().len(), 1);
}
