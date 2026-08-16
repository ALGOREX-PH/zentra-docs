#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _, MockAuth, MockAuthInvoke},
    vec, Address, Bytes, Env, Event as _, IntoVal, InvokeError, Symbol,
};

/// Three fresh signers — the canonical 2-of-3 committee used by most tests.
fn signers(env: &Env) -> (Address, Address, Address) {
    (
        Address::generate(env),
        Address::generate(env),
        Address::generate(env),
    )
}

fn deploy<'a>(env: &'a Env, set: Vec<Address>, threshold: u32) -> (MultiSigClient<'a>, Address) {
    let id = env.register(MultiSig, (set, threshold));
    (MultiSigClient::new(env, &id), id)
}

fn kind(env: &Env) -> Symbol {
    Symbol::new(env, "transfer")
}

fn payload(env: &Env) -> Bytes {
    Bytes::from_slice(env, &[0xde, 0xad, 0xbe, 0xef])
}

/// An unauthorized invocation aborts in the host before the contract can return
/// one of its own `Error` variants, so it surfaces as `Err(Err(Abort))` — not as
/// a contract error. Asserting this exact shape keeps the test from passing for
/// an unrelated reason such as bad arguments.
const MISSING_AUTHORIZATION: Result<Error, InvokeError> = Err(InvokeError::Abort);

// ---------------------------------------------------------------- constructor

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn constructor_rejects_zero_threshold() {
    let env = Env::default();
    let (a, b, c) = signers(&env);
    deploy(&env, vec![&env, a, b, c], 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn constructor_rejects_threshold_above_signer_count() {
    let env = Env::default();
    let (a, b, c) = signers(&env);
    deploy(&env, vec![&env, a, b, c], 4);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn constructor_rejects_empty_signers() {
    let env = Env::default();
    deploy(&env, vec![&env], 1);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn constructor_rejects_duplicate_signers() {
    let env = Env::default();
    let (a, b, _c) = signers(&env);
    // `a` twice: without the duplicate check a 2-of-3 would be satisfiable by
    // one key holding two seats.
    deploy(&env, vec![&env, a.clone(), b, a], 2);
}

#[test]
fn exposes_constructed_signers_and_threshold() {
    let env = Env::default();
    let (a, b, c) = signers(&env);
    let (client, _) = deploy(&env, vec![&env, a.clone(), b.clone(), c.clone()], 2);

    assert_eq!(client.get_threshold(), 2);
    assert_eq!(
        client.get_signers(),
        vec![&env, a.clone(), b.clone(), c.clone()]
    );
    assert!(client.is_signer(&a));
    assert!(client.is_signer(&b));
    assert!(client.is_signer(&c));
    assert!(!client.is_signer(&Address::generate(&env)));
    assert_eq!(client.get_count(), 0);
}

// ------------------------------------------------------------- membership

#[test]
fn non_signer_cannot_propose() {
    let env = Env::default();
    env.mock_all_auths();
    let (a, b, c) = signers(&env);
    let (client, _) = deploy(&env, vec![&env, a, b, c], 2);

    let outsider = Address::generate(&env);
    assert_eq!(
        client.try_propose(&outsider, &kind(&env), &payload(&env)),
        Err(Ok(Error::NotASigner))
    );
    assert_eq!(client.get_count(), 0);
}

#[test]
fn non_signer_cannot_approve() {
    let env = Env::default();
    env.mock_all_auths();
    let (a, b, c) = signers(&env);
    let (client, _) = deploy(&env, vec![&env, a.clone(), b, c], 2);

    let id = client.propose(&a, &kind(&env), &payload(&env));
    let outsider = Address::generate(&env);
    assert_eq!(
        client.try_approve(&outsider, &id),
        Err(Ok(Error::NotASigner))
    );
    assert_eq!(client.approvals_of(&id).len(), 0);
}

#[test]
fn propose_requires_proposer_authorization() {
    let env = Env::default();
    let (a, b, c) = signers(&env);
    let (client, _) = deploy(&env, vec![&env, a.clone(), b, c], 2);

    assert_eq!(
        client.try_propose(&a, &kind(&env), &payload(&env)),
        Err(MISSING_AUTHORIZATION)
    );
    assert_eq!(client.get_count(), 0);
}

#[test]
fn approve_requires_signer_authorization() {
    let env = Env::default();
    let (a, b, c) = signers(&env);
    let (client, contract) = deploy(&env, vec![&env, a.clone(), b.clone(), c], 2);
    let proposal_kind = kind(&env);
    let proposal_payload = payload(&env);
    env.mock_auths(&[MockAuth {
        address: &a,
        invoke: &MockAuthInvoke {
            contract: &contract,
            fn_name: "propose",
            args: (a.clone(), proposal_kind.clone(), proposal_payload.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    let id = client.propose(&a, &proposal_kind, &proposal_payload);

    assert_eq!(client.try_approve(&b, &id), Err(MISSING_AUTHORIZATION));
    assert_eq!(client.approvals_of(&id).len(), 0);
}

// ------------------------------------------------------------- happy path

#[test]
fn two_of_three_proposes_approves_and_executes() {
    let env = Env::default();
    env.mock_all_auths();
    let (a, b, c) = signers(&env);
    let (client, _) = deploy(&env, vec![&env, a.clone(), b.clone(), c.clone()], 2);

    let id = client.propose(&a, &kind(&env), &payload(&env));
    assert_eq!(id, 0);
    assert_eq!(client.get_count(), 1);

    let proposal = client.get_proposal(&id);
    assert_eq!(proposal.proposer, a);
    assert_eq!(proposal.kind, kind(&env));
    assert_eq!(proposal.payload, payload(&env));
    assert_eq!(proposal.approvals.len(), 0);
    assert!(!proposal.executed);

    // Proposing is not approving: the proposer still has to sign.
    client.approve(&a, &id);
    assert_eq!(client.approvals_of(&id), vec![&env, a.clone()]);

    client.approve(&b, &id);
    assert_eq!(client.approvals_of(&id), vec![&env, a.clone(), b.clone()]);

    client.execute(&id);
    let settled = client.get_proposal(&id);
    assert!(settled.executed);
    assert_eq!(settled.approvals.len(), 2);

    // Ids keep incrementing across proposals.
    assert_eq!(client.propose(&c, &kind(&env), &payload(&env)), 1);
    assert_eq!(client.get_count(), 2);
}

// -------------------------------------------------- the key security test

#[test]
fn rejects_double_approval_by_the_same_signer() {
    let env = Env::default();
    env.mock_all_auths();
    let (a, b, c) = signers(&env);
    let (client, _) = deploy(&env, vec![&env, a.clone(), b, c], 2);

    let id = client.propose(&a, &kind(&env), &payload(&env));
    client.approve(&a, &id);

    // Without this rule `a` alone would reach the 2-of-3 threshold.
    assert_eq!(client.try_approve(&a, &id), Err(Ok(Error::AlreadyApproved)));
    assert_eq!(client.approvals_of(&id).len(), 1);

    // And the proposal is still genuinely un-executable on one signature.
    assert_eq!(client.try_execute(&id), Err(Ok(Error::ThresholdNotMet)));
    assert!(!client.get_proposal(&id).executed);
}

// ------------------------------------------------------------- execution

#[test]
fn rejects_execute_below_threshold() {
    let env = Env::default();
    env.mock_all_auths();
    let (a, b, c) = signers(&env);
    let (client, _) = deploy(&env, vec![&env, a.clone(), b, c], 2);

    let id = client.propose(&a, &kind(&env), &payload(&env));
    assert_eq!(client.try_execute(&id), Err(Ok(Error::ThresholdNotMet)));

    client.approve(&a, &id);
    assert_eq!(client.try_execute(&id), Err(Ok(Error::ThresholdNotMet)));
    assert!(!client.get_proposal(&id).executed);
}

#[test]
fn rejects_double_execution() {
    let env = Env::default();
    env.mock_all_auths();
    let (a, b, c) = signers(&env);
    let (client, _) = deploy(&env, vec![&env, a.clone(), b.clone(), c], 2);

    let id = client.propose(&a, &kind(&env), &payload(&env));
    client.approve(&a, &id);
    client.approve(&b, &id);
    client.execute(&id);

    assert_eq!(client.try_execute(&id), Err(Ok(Error::AlreadyExecuted)));
    assert!(client.get_proposal(&id).executed);
}

#[test]
fn rejects_approval_of_executed_proposal() {
    let env = Env::default();
    env.mock_all_auths();
    let (a, b, c) = signers(&env);
    let (client, _) = deploy(&env, vec![&env, a.clone(), b.clone(), c.clone()], 2);

    let id = client.propose(&a, &kind(&env), &payload(&env));
    client.approve(&a, &id);
    client.approve(&b, &id);
    client.execute(&id);

    assert_eq!(client.try_approve(&c, &id), Err(Ok(Error::AlreadyExecuted)));
    assert_eq!(client.approvals_of(&id).len(), 2);
}

#[test]
fn rejects_approval_of_missing_proposal() {
    let env = Env::default();
    env.mock_all_auths();
    let (a, b, c) = signers(&env);
    let (client, _) = deploy(&env, vec![&env, a.clone(), b, c], 2);

    assert_eq!(
        client.try_approve(&a, &99),
        Err(Ok(Error::ProposalNotFound))
    );
    assert_eq!(client.try_execute(&7), Err(Ok(Error::ProposalNotFound)));
    // `Proposal` is not `Debug`/`PartialEq` (house style keeps `contracttype`
    // structs to `Clone`), so this one is matched rather than compared.
    assert!(matches!(
        client.try_get_proposal(&7),
        Err(Ok(Error::ProposalNotFound))
    ));
}

// ------------------------------------------------------------------ edges

#[test]
fn propose_rejects_counter_overflow() {
    let env = Env::default();
    env.mock_all_auths();
    let (a, b, c) = signers(&env);
    let (client, contract) = deploy(&env, vec![&env, a.clone(), b, c], 2);

    // Seed the counter at its ceiling; the next proposal must fail with a
    // typed error rather than wrap and overwrite proposal 0.
    env.as_contract(&contract, || {
        env.storage().instance().set(&DataKey::Count, &u64::MAX);
    });

    assert_eq!(
        client.try_propose(&a, &kind(&env), &payload(&env)),
        Err(Ok(Error::CounterOverflow))
    );
    assert_eq!(client.get_count(), u64::MAX);
}

#[test]
fn one_of_one_proposes_approves_and_executes() {
    let env = Env::default();
    env.mock_all_auths();
    let solo = Address::generate(&env);
    let (client, _) = deploy(&env, vec![&env, solo.clone()], 1);

    let id = client.propose(&solo, &kind(&env), &payload(&env));
    // Proposing is still not approving, even for a committee of one.
    assert_eq!(client.try_execute(&id), Err(Ok(Error::ThresholdNotMet)));

    client.approve(&solo, &id);
    client.execute(&id);
    assert!(client.get_proposal(&id).executed);
}

#[test]
fn full_committee_threshold_requires_every_signer() {
    let env = Env::default();
    env.mock_all_auths();
    let (a, b, c) = signers(&env);
    let (client, _) = deploy(&env, vec![&env, a.clone(), b.clone(), c.clone()], 3);

    let id = client.propose(&a, &kind(&env), &payload(&env));
    client.approve(&a, &id);
    client.approve(&b, &id);
    // 2 of 3 is not enough when the threshold is the whole signer set.
    assert_eq!(client.try_execute(&id), Err(Ok(Error::ThresholdNotMet)));

    client.approve(&c, &id);
    client.execute(&id);
    assert!(client.get_proposal(&id).executed);
}

// ---------------------------------------------------------------- events

#[test]
fn emits_proposed_approved_and_executed_events() {
    let env = Env::default();
    env.mock_all_auths();
    let (a, b, c) = signers(&env);
    let (client, contract) = deploy(&env, vec![&env, a.clone(), b.clone(), c], 2);

    // `events().all()` returns the events of the last invocation only, so each
    // call is checked immediately after it is made.
    let id = client.propose(&a, &kind(&env), &payload(&env));
    let proposed = Proposed {
        id,
        proposer: a.clone(),
        kind: kind(&env),
        ledger: env.ledger().sequence(),
    };
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (contract.clone(), proposed.topics(&env), proposed.data(&env))
        ]
    );

    client.approve(&a, &id);
    let approved = Approved {
        id,
        signer: a.clone(),
        approvals: 1,
        threshold: 2,
    };
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (contract.clone(), approved.topics(&env), approved.data(&env))
        ]
    );

    client.approve(&b, &id);
    assert_eq!(env.events().all().events().len(), 1);

    client.execute(&id);
    let executed = ExecutedEvent {
        id,
        kind: kind(&env),
        payload: payload(&env),
        approvals: 2,
        ledger: env.ledger().sequence(),
    };
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (contract.clone(), executed.topics(&env), executed.data(&env))
        ]
    );
}
