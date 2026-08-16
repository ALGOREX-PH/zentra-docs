/**
 * Beginner-facing explanations for the proof playground. The public-signal
 * labels match the circuit's `public [...]` declaration exactly (verified
 * against payment_policy.circom), so what users read is what the proof exposes.
 */

import type { ProofStage } from '@/lib/zk/prover';

export type SignalKind = 'hash' | 'value';

export interface SignalInfo {
  name: string;
  label: string;
  /** Beginner-facing explanation, shown in the playground's signals table. */
  desc: string;
  /** Terse technical meaning, shown in the docs reference table. */
  meaning: string;
  /** How the value reaches the field, e.g. `i128 → Fr` (docs Encoding column). */
  encoding: string;
  kind: SignalKind;
}

/**
 * The 14 public signals, in the exact order snarkjs emits them.
 *
 * This is the single source for the circuit ↔ contract ↔ serialization
 * contract: the playground's signals table, the docs' public-inputs table and
 * the system bar's signal count all render from this list.
 */
export const SIGNALS: SignalInfo[] = [
  {
    name: 'policyCommitment',
    label: 'Policy commitment',
    desc: 'A one-way hash that locks in the private policy (spend limits + allowed vendors). The proof opens it without revealing the policy.',
    meaning: 'Poseidon commitment of the private policy',
    encoding: 'Fr',
    kind: 'hash',
  },
  {
    name: 'recipientRoot',
    label: 'Approved-vendor root',
    desc: 'A Merkle root summarizing the allowlist of approved recipients. The proof shows the payee is somewhere in that set.',
    meaning: 'Merkle root of the approved recipients',
    encoding: 'Fr',
    kind: 'hash',
  },
  {
    name: 'recipient',
    label: 'Recipient',
    desc: 'The specific vendor being paid (revealed at settlement anyway).',
    meaning: 'The payee, reduced to a field element',
    encoding: 'Fr',
    kind: 'value',
  },
  {
    name: 'amount',
    label: 'Amount',
    desc: 'The payment amount in 7-decimal units. The proof shows it is ≤ a private maximum you never see.',
    meaning: 'Payment amount, in stroops',
    encoding: 'i128 → Fr',
    kind: 'value',
  },
  {
    name: 'invoiceHash',
    label: 'Invoice hash',
    desc: 'A hash of the invoice. The proof shows the agent holds a matching invoice without exposing it.',
    meaning: 'Poseidon hash of the invoice preimage',
    encoding: 'Fr',
    kind: 'hash',
  },
  {
    name: 'nullifier',
    label: 'Nullifier',
    desc: 'A one-time tag. The contract rejects a repeat, so the same proof can never be replayed.',
    meaning: 'Single-use replay marker',
    encoding: 'Fr',
    kind: 'hash',
  },
  {
    name: 'agentAddress',
    label: 'Agent',
    desc: 'The AI agent making the payment, bound to its on-chain identity.',
    meaning: 'The paying agent, reduced to a field element',
    encoding: 'Fr',
    kind: 'value',
  },
  {
    name: 'assetId',
    label: 'Asset',
    desc: 'The token being paid — e.g. USDC.',
    meaning: 'The asset (SAC), reduced to a field element',
    encoding: 'Fr',
    kind: 'value',
  },
  {
    name: 'contractAddress',
    label: 'Verifier',
    desc: 'The contract this proof is bound to, so it cannot be replayed against a different contract.',
    meaning: 'The verifier contract, reduced to a field element',
    encoding: 'Fr',
    kind: 'value',
  },
  {
    name: 'prevEpochId',
    label: 'Prev. epoch',
    desc: 'The spending window (e.g. the day) the agent was in.',
    meaning: 'Epoch the prior counters belong to',
    encoding: 'u64 → Fr',
    kind: 'value',
  },
  {
    name: 'prevSpent',
    label: 'Prev. spent',
    desc: 'How much the agent already spent this window — pinned to on-chain state so it cannot lie.',
    meaning: 'Spend before this action',
    encoding: 'i128 → Fr',
    kind: 'value',
  },
  {
    name: 'prevActionCount',
    label: 'Prev. actions',
    desc: 'The agent’s action counter before this payment.',
    meaning: 'Action count before this action',
    encoding: 'u64 → Fr',
    kind: 'value',
  },
  {
    name: 'newSpent',
    label: 'New spent',
    desc: 'prevSpent + amount. The proof shows this stays ≤ a private daily limit.',
    meaning: 'prevSpent + amount',
    encoding: 'i128 → Fr',
    kind: 'value',
  },
  {
    name: 'newActionCount',
    label: 'New actions',
    desc: 'prevActionCount + 1 — a valid, tamper-evident state transition.',
    meaning: 'prevActionCount + 1',
    encoding: 'u64 → Fr',
    kind: 'value',
  },
];

/** What stays secret — never leaves the browser, never appears in the proof. */
export const PRIVATE_INPUTS: { label: string; desc: string }[] = [
  { label: 'Max amount', desc: 'The largest single payment the policy allows.' },
  { label: 'Daily limit', desc: 'The most the agent may spend per window.' },
  {
    label: 'Allowed vendors',
    desc: 'The full approved-recipient list (only the Merkle root is public).',
  },
  { label: 'Policy salt', desc: 'Randomness that hides the policy behind its commitment.' },
  { label: 'Invoice', desc: 'The invoice pre-image behind the invoice hash.' },
];

/** Plain-language statement of what a valid proof guarantees. */
export const PROVES: string[] = [
  'The payment opens the committed policy — so the rules are real, not made up.',
  'The recipient is in the approved-vendor set.',
  'The amount is within a spending limit you never reveal.',
  'Past spend + this amount stays under the daily limit.',
  'A matching invoice exists, and this proof can’t be replayed.',
];

export interface PipelineStep {
  label: string;
  /** The observable run phase that drives this step. */
  stage: ProofStage;
}

/**
 * The four steps a run walks through, in order. Only the circuit download is
 * observable on its own; the other three share one worker round-trip, so they
 * light up — and settle — together.
 */
export const PIPELINE: PipelineStep[] = [
  { label: 'Load circuit', stage: 'circuit' },
  { label: 'Compute witness', stage: 'proving' },
  { label: 'Generate proof', stage: 'proving' },
  { label: 'Verify', stage: 'proving' },
];

/** What the run is actually doing, per observable phase. */
export const STAGE_STATUS: Record<ProofStage, string> = {
  circuit: 'Downloading the compiled circuit, proving key and verification key.',
  proving: 'Computing the witness, proving and verifying — in a Web Worker, off the main thread.',
};

export interface GlossaryTerm {
  term: string;
  body: string;
}

/** Expandable definitions for the jargon on the page. */
export const GLOSSARY: GlossaryTerm[] = [
  {
    term: 'Zero-knowledge proof',
    body: 'A way to prove a statement is true while revealing nothing beyond the statement itself. Here: "this payment follows my rules" — without showing the rules.',
  },
  {
    term: 'Groth16',
    body: 'A specific, very compact zk-SNARK proving system. Proofs are tiny (three elliptic-curve points) and verify in milliseconds, which is what makes on-chain verification practical.',
  },
  {
    term: 'BN254',
    body: 'The elliptic curve the proof is built on. Stellar added BN254 host functions, so a Soroban contract can verify these proofs directly.',
  },
  {
    term: 'Witness',
    body: 'The full set of inputs (public + private) run through the circuit. It is computed in your browser and never leaves it.',
  },
  {
    term: 'Public signals',
    body: 'The values the proof exposes (and a verifier checks against). Everything else stays private.',
  },
  {
    term: 'Commitment',
    body: 'A one-way hash that "locks in" a secret. You can later prove things about the secret without revealing it.',
  },
  {
    term: 'Merkle root',
    body: 'A single hash that fingerprints a whole list. You can prove an item is in the list against just the root.',
  },
  {
    term: 'Nullifier',
    body: 'A one-time marker that prevents the same proof being used twice (replay protection).',
  },
  {
    term: 'π_a, π_b, π_c',
    body: 'The three elliptic-curve points that make up a Groth16 proof — that is the entire proof.',
  },
];
