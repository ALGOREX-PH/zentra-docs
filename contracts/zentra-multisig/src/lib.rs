#![no_std]
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, vec, Address, Bytes, Env,
    Symbol, Vec,
};

const DAY_LEDGERS: u32 = 17_280; // ~1 day at 5s ledgers
const INSTANCE_BUMP: u32 = 30 * DAY_LEDGERS;
const INSTANCE_THRESHOLD: u32 = INSTANCE_BUMP - DAY_LEDGERS;
const ENTRY_BUMP: u32 = 90 * DAY_LEDGERS;
const ENTRY_THRESHOLD: u32 = ENTRY_BUMP - DAY_LEDGERS;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Signers,
    Threshold,
    Count,
    Proposal(u64),
}

/// One pending or settled action: who raised it, what it is, who has signed off,
/// and whether the threshold has already been discharged.
#[contracttype]
#[derive(Clone)]
pub struct Proposal {
    pub id: u64,
    pub proposer: Address,
    pub kind: Symbol,
    pub payload: Bytes,
    pub ledger: u32,
    pub approvals: Vec<Address>,
    pub executed: bool,
}

/// Emitted whenever a signer raises a proposal — the frontend streams these to
/// show the pending queue (topic `proposed`).
#[contractevent(topics = ["proposed"])]
pub struct Proposed {
    pub id: u64,
    pub proposer: Address,
    pub kind: Symbol,
    pub ledger: u32,
}

/// Emitted on each distinct approval, carrying the running tally against the
/// threshold so the frontend can render "2 of 3" without a second read.
#[contractevent(topics = ["approved"])]
pub struct Approved {
    pub id: u64,
    pub signer: Address,
    pub approvals: u32,
    pub threshold: u32,
}

/// Emitted once, when a proposal crosses its threshold and is discharged. This
/// event *is* the authorization — see `execute` for what a consumer must do.
#[contractevent(topics = ["executed"])]
pub struct ExecutedEvent {
    pub id: u64,
    pub kind: Symbol,
    pub payload: Bytes,
    pub approvals: u32,
    pub ledger: u32,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    EmptySigners = 1,
    DuplicateSigner = 2,
    InvalidThreshold = 3,
    NotASigner = 4,
    ProposalNotFound = 5,
    AlreadyApproved = 6,
    AlreadyExecuted = 7,
    ThresholdNotMet = 8,
    CounterOverflow = 9,
}

/// The signer set, loaded from instance storage. Panics only if the contract was
/// never constructed, which the host makes impossible for a deployed contract.
fn signers_of(env: &Env) -> Vec<Address> {
    env.storage().instance().get(&DataKey::Signers).unwrap()
}

/// The N in "N-of-M", loaded from instance storage.
fn threshold_of(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::Threshold).unwrap()
}

/// Load a proposal, turning a missing id into a typed error rather than a trap.
fn load(env: &Env, id: u64) -> Result<Proposal, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Proposal(id))
        .ok_or(Error::ProposalNotFound)
}

/// Write a proposal back and refresh its TTL, the same way the Action Log
/// contract keeps its entries alive.
fn save(env: &Env, proposal: &Proposal) {
    let key = DataKey::Proposal(proposal.id);
    env.storage().persistent().set(&key, proposal);
    env.storage()
        .persistent()
        .extend_ttl(&key, ENTRY_THRESHOLD, ENTRY_BUMP);
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_BUMP);
}

#[contract]
pub struct MultiSig;

#[contractimpl]
impl MultiSig {
    /// Fix the signer set and the approval threshold once, at deployment.
    ///
    /// Rejected at construction rather than papered over later: an empty signer
    /// set, a zero threshold (which would let anyone execute anything), a
    /// threshold larger than the signer set (which would deadlock every
    /// proposal), and duplicate signers — a duplicate would let one key be
    /// counted twice toward N and quietly collapse the security model.
    pub fn __constructor(env: Env, signers: Vec<Address>, threshold: u32) -> Result<(), Error> {
        if signers.is_empty() {
            return Err(Error::EmptySigners);
        }
        if threshold == 0 || threshold > signers.len() {
            return Err(Error::InvalidThreshold);
        }

        // O(n^2) pairwise scan. Signer sets are small (single digits), and this
        // runs exactly once, at deployment.
        let n = signers.len();
        let mut i: u32 = 0;
        while i < n {
            let a = signers.get(i).unwrap();
            let mut j: u32 = i + 1;
            while j < n {
                if a == signers.get(j).unwrap() {
                    return Err(Error::DuplicateSigner);
                }
                j += 1;
            }
            i += 1;
        }

        env.storage().instance().set(&DataKey::Signers, &signers);
        env.storage().instance().set(&DataKey::Threshold, &threshold);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_BUMP);

        Ok(())
    }

    /// Raise a proposal. Only a member of the signer set may propose, so an
    /// outsider cannot spam the queue. Stores it with an empty approval set,
    /// emits a `proposed` event, and returns the new id.
    ///
    /// Proposing does *not* imply approving — the proposer must still call
    /// `approve` to be counted, which keeps the tally honest for a 1-of-M as
    /// well as an N-of-M.
    pub fn propose(env: Env, proposer: Address, kind: Symbol, payload: Bytes) -> Result<u64, Error> {
        proposer.require_auth();

        if !signers_of(&env).contains(&proposer) {
            return Err(Error::NotASigner);
        }

        let id: u64 = env.storage().instance().get(&DataKey::Count).unwrap_or(0);
        // Wrapping the counter would let a new proposal overwrite an old one, so
        // overflow is a hard error rather than a silent wrap.
        let next = id.checked_add(1).ok_or(Error::CounterOverflow)?;

        let proposal = Proposal {
            id,
            proposer: proposer.clone(),
            kind: kind.clone(),
            payload,
            ledger: env.ledger().sequence(),
            approvals: vec![&env],
            executed: false,
        };

        save(&env, &proposal);
        env.storage().instance().set(&DataKey::Count, &next);

        Proposed {
            id,
            proposer,
            kind,
            ledger: proposal.ledger,
        }
        .publish(&env);

        Ok(id)
    }

    /// Record `signer`'s approval of proposal `id`.
    ///
    /// THE SINGLE MOST IMPORTANT RULE IN THIS CONTRACT: approving twice is an
    /// error, not a silent no-op. If a repeat approval were tolerated and simply
    /// appended — or even accepted and ignored — one signer could call `approve`
    /// N times and satisfy the threshold alone, which reduces an N-of-M multisig
    /// to a 1-of-M. The duplicate check below is what makes the "N" mean
    /// anything, so it is enforced as `AlreadyApproved` and never softened.
    pub fn approve(env: Env, signer: Address, id: u64) -> Result<(), Error> {
        signer.require_auth();

        if !signers_of(&env).contains(&signer) {
            return Err(Error::NotASigner);
        }

        let mut proposal = load(&env, id)?;
        if proposal.executed {
            return Err(Error::AlreadyExecuted);
        }
        // See the rule above — this is the load-bearing line.
        if proposal.approvals.contains(&signer) {
            return Err(Error::AlreadyApproved);
        }

        proposal.approvals.push_back(signer.clone());
        let approvals = proposal.approvals.len();
        save(&env, &proposal);

        Approved {
            id,
            signer,
            approvals,
            threshold: threshold_of(&env),
        }
        .publish(&env);

        Ok(())
    }

    /// Discharge a proposal that has reached its threshold.
    ///
    /// This contract moves no funds and makes no cross-contract call: it decides
    /// *that* an action is authorized and publishes that decision as an
    /// `executed` event. The caller — a relayer, a backend worker, or another
    /// contract watching the stream — is responsible for acting on `kind` and
    /// `payload`. Consumers must treat the event as one-shot and idempotent on
    /// `id`, because this contract will never emit it twice for the same
    /// proposal.
    ///
    /// `executed` is flipped and written to storage *before* the event is
    /// published — check-effects-interactions ordering. Doing the effect first
    /// means a re-entrant call arriving during the interaction re-reads an
    /// already-executed proposal and bounces off `AlreadyExecuted`, so a
    /// proposal can never be discharged twice.
    ///
    /// Deliberately unauthenticated: the approvals already carry the
    /// authorization, so anyone may pay the fee to push a fully-approved
    /// proposal over the line.
    pub fn execute(env: Env, id: u64) -> Result<(), Error> {
        let mut proposal = load(&env, id)?;

        if proposal.executed {
            return Err(Error::AlreadyExecuted);
        }
        let approvals = proposal.approvals.len();
        if approvals < threshold_of(&env) {
            return Err(Error::ThresholdNotMet);
        }

        // Effect before interaction.
        proposal.executed = true;
        save(&env, &proposal);

        ExecutedEvent {
            id,
            kind: proposal.kind,
            payload: proposal.payload,
            approvals,
            ledger: env.ledger().sequence(),
        }
        .publish(&env);

        Ok(())
    }

    /// Fetch a proposal by id.
    pub fn get_proposal(env: Env, id: u64) -> Result<Proposal, Error> {
        load(&env, id)
    }

    /// The addresses that have approved proposal `id`, in approval order.
    pub fn approvals_of(env: Env, id: u64) -> Result<Vec<Address>, Error> {
        Ok(load(&env, id)?.approvals)
    }

    /// The full signer set (the M in "N-of-M").
    pub fn get_signers(env: Env) -> Vec<Address> {
        signers_of(&env)
    }

    /// The approvals required to execute (the N in "N-of-M").
    pub fn get_threshold(env: Env) -> u32 {
        threshold_of(&env)
    }

    /// Whether `who` is a member of the signer set.
    pub fn is_signer(env: Env, who: Address) -> bool {
        signers_of(&env).contains(&who)
    }

    /// Total number of proposals ever raised; also the id the next one gets.
    pub fn get_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::Count).unwrap_or(0)
    }
}

mod test;
