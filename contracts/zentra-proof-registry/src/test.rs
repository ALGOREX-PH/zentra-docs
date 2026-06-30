#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    Address, BytesN, Env,
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
fn emits_anchored_event() {
    let env = Env::default();
    env.mock_all_auths();
    let client = client(&env);
    let prover = Address::generate(&env);
    let commitment = BytesN::from_array(&env, &[7u8; 32]);

    client.anchor(&prover, &commitment, &14);
    assert_eq!(env.events().all().events().len(), 1);
}
