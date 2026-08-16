#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    vec,
    xdr::{ScErrorCode, ScErrorType},
    Address, BytesN, Env, Error as SdkError, Event as _,
};

fn client(env: &Env) -> ProofRegistryClient<'_> {
    let id = env.register(ProofRegistry, ());
    ProofRegistryClient::new(env, &id)
}

#[test]
fn anchors_and_counts() {
    let env = Env::default();
    env.mock_all_auths();
    let client = client(&env);
    let prover = Address::generate(&env);
    let commitment = BytesN::from_array(&env, &[7u8; 32]);

    client.anchor(&prover, &commitment, &14);
    client.anchor(&prover, &commitment, &14);

    assert_eq!(client.get_count(), 2);

    let recent = client.get_recent(&2);
    assert_eq!(recent.len(), 2);
    assert_eq!(recent.get(0).unwrap().index, 1);
    assert_eq!(recent.get(1).unwrap().index, 0);
}

#[test]
fn recent_returns_min_of_limit_and_count() {
    let env = Env::default();
    env.mock_all_auths();
    let client = client(&env);
    let prover = Address::generate(&env);
    let commitment = BytesN::from_array(&env, &[7u8; 32]);

    client.anchor(&prover, &commitment, &14);
    client.anchor(&prover, &commitment, &14);
    client.anchor(&prover, &commitment, &14);

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
    let prover = Address::generate(&env);
    let commitment = BytesN::from_array(&env, &[7u8; 32]);

    for _ in 0..(MAX_RECENT + 5) {
        client.anchor(&prover, &commitment, &14);
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
    let prover = Address::generate(&env);
    let commitment = BytesN::from_array(&env, &[7u8; 32]);

    client.anchor(&prover, &commitment, &14);
    client.anchor(&prover, &commitment, &14);
    client.anchor(&prover, &commitment, &14);

    // Simulate the defensive None arm: punch a hole in storage and make sure a
    // skipped entry does not eat a slot of the requested limit.
    env.as_contract(&client.address, || {
        env.storage().persistent().remove(&DataKey::Entry(1));
    });

    let recent = client.get_recent(&2);
    assert_eq!(recent.len(), 2);
    assert_eq!(recent.get(0).unwrap().index, 2);
    assert_eq!(recent.get(1).unwrap().index, 0);
}

#[test]
fn emits_anchored_event() {
    let env = Env::default();
    env.mock_all_auths();
    let client = client(&env);
    let prover = Address::generate(&env);
    let commitment = BytesN::from_array(&env, &[7u8; 32]);

    client.anchor(&prover, &commitment, &14);
    let anchored = Anchored {
        index: 0,
        prover: prover.clone(),
        commitment: commitment.clone(),
        signals: 14,
        ledger: env.ledger().sequence(),
    };
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                client.address.clone(),
                anchored.topics(&env),
                anchored.data(&env)
            )
        ]
    );
}

#[test]
fn anchor_requires_prover_authorization() {
    let env = Env::default();
    let client = client(&env);
    let prover = Address::generate(&env);
    let commitment = BytesN::from_array(&env, &[7u8; 32]);

    let result = client.try_anchor(&prover, &commitment, &14);

    assert_eq!(
        result,
        Err(Ok(SdkError::from_type_and_code(
            ScErrorType::Context,
            ScErrorCode::InvalidAction,
        )))
    );
}
