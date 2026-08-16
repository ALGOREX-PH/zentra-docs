#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    vec, Address, BytesN, Env, Event as _, InvokeError,
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
fn gets_entry_by_index() {
    let env = Env::default();
    env.mock_all_auths();
    let client = client(&env);
    let prover = Address::generate(&env);
    let commitment = BytesN::from_array(&env, &[9u8; 32]);

    client.anchor(&prover, &commitment, &14);

    let entry = client.get_entry(&0).unwrap();
    assert_eq!(entry.index, 0);
    assert_eq!(entry.prover, prover);
    assert_eq!(entry.commitment, commitment);
    assert_eq!(entry.signals, 14);
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

    // An unauthorized invocation aborts in the host before the contract can
    // return one of its own `Error` variants, so it surfaces as
    // `Err(Err(Abort))` — not as a contract error.
    assert_eq!(result, Err(Err(InvokeError::Abort)));
    assert_eq!(client.get_count(), 0);
}

#[test]
fn rejects_zero_signals() {
    let env = Env::default();
    env.mock_all_auths();
    let client = client(&env);
    let prover = Address::generate(&env);
    let commitment = BytesN::from_array(&env, &[7u8; 32]);

    assert_eq!(
        client.try_anchor(&prover, &commitment, &0),
        Err(Ok(Error::NoSignals))
    );
    assert_eq!(client.get_count(), 0);
}

#[test]
fn accepts_max_signals_and_rejects_one_above() {
    let env = Env::default();
    env.mock_all_auths();
    let client = client(&env);
    let prover = Address::generate(&env);
    let commitment = BytesN::from_array(&env, &[7u8; 32]);

    // MAX_SIGNALS itself is within budget; one more is not.
    assert_eq!(client.anchor(&prover, &commitment, &MAX_SIGNALS), 0);
    assert_eq!(
        client.try_anchor(&prover, &commitment, &(MAX_SIGNALS + 1)),
        Err(Ok(Error::TooManySignals))
    );
    assert_eq!(client.get_count(), 1);
}
