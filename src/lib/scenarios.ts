export type Outcome = 'settled' | 'blocked-proof' | 'blocked-chain';

export interface Scenario {
  id: 'A' | 'B' | 'C';
  title: string;
  subtitle: string;
  /** The StatusEvent phases this scenario emits, in order. */
  steps: string[];
  outcome: Outcome;
  outcomeLabel: string;
  /** Which check fired, in plain language. */
  explanation: string;
}

/**
 * The three scenarios that prove the thesis. Shared by the landing strip and the
 * playground so the marketing animation and the interactive demo never diverge.
 */
export const SCENARIOS: Scenario[] = [
  {
    id: 'A',
    title: 'Legitimate payment',
    subtitle: 'Approved vendor, within limits',
    steps: ['proving', 'proof-ready', 'submitting', 'released'],
    outcome: 'settled',
    outcomeLabel: 'Settled',
    explanation:
      'Valid proof, matching state, fresh nullifier — the contract verifies and settles.',
  },
  {
    id: 'B',
    title: 'Prompt injection',
    subtitle: 'Pay an attacker not on the allowlist',
    steps: ['proving', 'blocked'],
    outcome: 'blocked-proof',
    outcomeLabel: 'Blocked at proof',
    explanation:
      'No Merkle path for a non-member, so no proof can be produced. Nothing is submitted.',
  },
  {
    id: 'C',
    title: 'Over-spend',
    subtitle: 'Claims prevSpent = 0 after spending 400',
    steps: ['proving', 'proof-ready', 'submitting', 'blocked'],
    outcome: 'blocked-chain',
    outcomeLabel: 'Blocked on-chain',
    explanation:
      "The proof is valid, but the contract's state binding rejects the forged prior spend (StateMismatch).",
  },
];
