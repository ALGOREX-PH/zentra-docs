export type Outcome = 'settled' | 'blocked-proof' | 'blocked-chain';

/** The scenario keys the landing's proof engine plays, in SCENARIOS order. */
export type LandingKey = 'valid' | 'injection' | 'overspend';

/**
 * The canonical over-spend story, matching the docs
 * (`guides/three-failure-modes`, `how-it-works/state-binding`): the agent has
 * already spent 400 of a 500 daily limit, then claims a prior spend of 0.
 * Every surface that quotes these numbers reads them from here.
 */
export const OVERSPEND = {
  /** What the forged proof claims was already spent this epoch. */
  claimed: 0,
  /** What the chain actually recorded before the attempt. */
  chainSpent: 400,
  /** The private daily limit the real figures are checked against. */
  dailyLimit: 500,
} as const;

/**
 * One stop on the landing rail. The two surfaces narrate the same walk in
 * different voices — the scenario panels report completed states, the proof
 * engine speaks in the present tense — so each stop carries both phrasings.
 */
export interface RailStep {
  /** Compact, completed-state label for the scenario panels' status readout. */
  panel: string;
  /** Present-tense terminal line for the proof engine. */
  engine: string;
}

/** The landing-strip presentation of a scenario, defined nowhere else. */
export interface LandingConfig {
  /** The proof engine's scenario key. */
  key: LandingKey;
  /** Panel header stamp, e.g. `PANEL_A // LEGIT`. */
  panelLabel: string;
  /** Property tags shown under the panel title. */
  tags: string[];
  /**
   * The rail stops this scenario walks, in order. The run halts on the last
   * entry, so the stop index is always `rail.length - 1` — a blocked scenario
   * simply carries a shorter rail.
   */
  rail: RailStep[];
  /** One-line takeaway under the panel rail. */
  desc: string;
  /** Autoplay stagger for the panel strip, in ms. */
  delay: number;
}

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
  /** How the landing strip presents this scenario. */
  landing: LandingConfig;
}

/**
 * The three scenarios that prove the thesis. Shared by the landing strip and the
 * playground so the marketing animation and the interactive demo never diverge.
 * The landing configs below (`LANDING_PANELS`, `LANDING_MESSAGES`) are pure
 * projections of these entries — there is no second copy to drift.
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
    landing: {
      key: 'valid',
      panelLabel: 'PANEL_A // LEGIT',
      tags: ['approved vendor', 'within limit', 'nullifier unused'],
      rail: [
        { panel: 'composing', engine: 'composing action' },
        { panel: 'policy passed', engine: 'checking private policy' },
        { panel: 'proof generated', engine: 'generating proof' },
        { panel: 'state bound', engine: 'binding to authority state' },
        { panel: 'verified', engine: 'verifying on-chain' },
        { panel: 'settling', engine: 'settling on Stellar' },
        { panel: 'receipt emitted', engine: 'receipt emitted' },
      ],
      desc: 'A valid agent action proves compliance, settles on testnet, and emits a verifiable receipt.',
      delay: 200,
    },
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
    landing: {
      key: 'injection',
      panelLabel: 'PANEL_B // INJECTION',
      tags: ['malicious recipient', 'not in allowlist'],
      rail: [
        { panel: 'composing', engine: 'composing action' },
        { panel: 'checking policy', engine: 'checking private policy' },
      ],
      desc: 'A malicious recipient fails the private policy check before a proof is ever produced.',
      delay: 700,
    },
  },
  {
    id: 'C',
    title: 'Over-spend',
    subtitle: `Claims prevSpent = ${OVERSPEND.claimed} after spending ${OVERSPEND.chainSpent}`,
    steps: ['proving', 'proof-ready', 'submitting', 'blocked'],
    outcome: 'blocked-chain',
    outcomeLabel: 'Blocked on-chain',
    explanation:
      "The proof is valid, but the contract's state binding rejects the forged prior spend (StateMismatch).",
    landing: {
      key: 'overspend',
      panelLabel: 'PANEL_C // OVERSPEND',
      tags: ['exceeds daily limit', 'false zero spend'],
      rail: [
        { panel: 'composing', engine: 'composing action' },
        { panel: 'policy passed', engine: 'checking private policy' },
        { panel: 'proof generated', engine: 'generating proof' },
        { panel: 'binding to state', engine: 'binding to authority state' },
      ],
      desc: 'A valid-looking proof cannot override authoritative on-chain state.',
      delay: 1200,
    },
  },
];

/** The scenario-panels strip config, projected straight from SCENARIOS. */
export interface LandingPanelConfig {
  id: Scenario['id'];
  key: LandingKey;
  label: string;
  title: string;
  tags: string[];
  /** Panel-voice rail labels, one per stop. */
  steps: string[];
  /** Index of the stop the run halts on. */
  stop: number;
  desc: string;
  delay: number;
  /** Whether the walk completes (settles) or is cut short (blocked). */
  settles: boolean;
}

export const LANDING_PANELS: LandingPanelConfig[] = SCENARIOS.map((s) => ({
  id: s.id,
  key: s.landing.key,
  label: s.landing.panelLabel,
  title: s.title,
  tags: s.landing.tags,
  steps: s.landing.rail.map((step) => step.panel),
  stop: s.landing.rail.length - 1,
  desc: s.landing.desc,
  delay: s.landing.delay,
  settles: s.outcome === 'settled',
}));

/** The proof engine's terminal lines per scenario, projected from SCENARIOS. */
export const LANDING_MESSAGES: Record<LandingKey, string[]> = Object.fromEntries(
  SCENARIOS.map((s) => [s.landing.key, s.landing.rail.map((step) => step.engine)]),
) as Record<LandingKey, string[]>;
