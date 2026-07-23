/**
 * The pitch deck, as data.
 *
 * This module is the single source of the deck's content. The `/pitch` route
 * renders `PITCH_SLIDES` and owns nothing but presentation, so a slide is
 * edited in one place, reviewed as a diff, and can never say something the
 * rest of the site contradicts. Contract ids and the CPU figure are imported
 * from `src/config/*` — the same single-source files the docs, the landing
 * page and the dApp read — rather than retyped here, so a redeploy updates the
 * deck along with everything else.
 *
 * Editing rule, because this deck is shown to investors and judges: every
 * claim must be traceable to something in this repository — `README.md`,
 * `docs/ARCHITECTURE.md`, `docs/BELT-CHECKLIST.md`, `docs/API.md`,
 * `content/docs/**`, `src/lib/zk/education.ts`, or the Rust sources under
 * `contracts/`. Where a claim is unproven, testnet-only, or measured somewhere
 * else, put the caveat in `note` instead of dropping it.
 */

import { actionLog } from '@/config/contract';
import { protocol } from '@/config/protocol';

export interface PitchBullet {
  label: string;
  body: string;
}

export interface PitchSlide {
  /** URL-safe id, used as the slide anchor. */
  id: string;
  /** Small label above the title, e.g. 'PROBLEM'. */
  eyebrow: string;
  title: string;
  /** One or two sentences setting up the slide. Optional. */
  lead?: string;
  bullets?: PitchBullet[];
  /** A single emphasised figure or claim, e.g. '$0 recovered'. Optional. */
  stat?: { value: string; caption: string };
  /** Small print under the slide — caveats, sources. Optional. */
  note?: string;
}

export const PITCH_SLIDES: PitchSlide[] = [
  {
    id: 'title',
    eyebrow: 'ZENTRA // ZK POLICY LAYER',
    title: 'Let agents act. Make them prove it.',
    lead: 'Zentra is a zero-knowledge policy layer for autonomous AI agents on Stellar. An agent can trigger a payment only after proving, in zero knowledge, that the action obeyed a private, user-defined policy — and a Soroban contract verifies that proof before any money moves.',
    stat: {
      value: 'No proof, no payment.',
      caption: 'The one invariant the protocol enforces.',
    },
    note: 'v0.1 is live on Stellar testnet: four deployed Soroban contracts, a working multi-wallet dApp, and real in-browser Groth16 proving. It is unaudited and not on mainnet.',
  },

  {
    id: 'problem',
    eyebrow: 'PROBLEM',
    title: 'Agents are being handed spending authority with no verifiable constraint.',
    lead: 'An agent that can call a payment API can move real money at machine speed. What is shipped around it today is trust before the action and an audit log after it.',
    bullets: [
      {
        label: 'Prompt injection is an authorization bypass',
        body: 'Text the agent reads becomes an instruction it follows. The resulting payment is correctly signed and correctly authorized — and wrong. Nothing in the signing path can tell the two apart.',
      },
      {
        label: 'The agent reports its own history',
        body: 'A daily limit enforced inside the agent is enforced by the thing being constrained. Ask a compromised agent what it has already spent and it answers zero.',
      },
      {
        label: 'Identity and permissions stop one question short',
        body: 'Who the agent is (ERC-8004-style identity) and what it may touch (ERC-7715-style permissions) are being solved. Neither says whether this specific action, right now, obeyed the rule.',
      },
      {
        label: 'Audit is reconstruction, not prevention',
        body: 'Logs explain a drained treasury after settlement. An irreversible on-chain transfer does not care what the log says.',
      },
    ],
    stat: {
      value: 'After the fact',
      caption: 'The default control for agentic payments today — a trail written once the money has already moved.',
    },
    note: 'The three failure modes named here are the three the protocol demo exercises end to end on testnet: a legitimate payment settles, a prompt-injected payment to a recipient outside the allowlist cannot produce a proof at all, and an agent that understates prior spend is rejected on-chain (src/lib/scenarios.ts; the zentra-protocol README records the settled and blocked cases).',
  },

  {
    id: 'solution',
    eyebrow: 'SOLUTION',
    title: 'Make compliance something the agent has to prove.',
    lead: 'Zentra puts a proof between the agent and the money. The rules stay private; the compliance is public and checkable by anyone.',
    bullets: [
      {
        label: 'Prove',
        body: 'The agent generates a Groth16 proof over BN254 (Circom + snarkjs) that the action satisfies a private policy — approved recipients, a per-invoice cap, a daily limit, a matching invoice, and a single-use nullifier.',
      },
      {
        label: 'Verify',
        body: 'A Soroban contract runs the full pairing check on-chain and binds the proof to the agent’s authoritative AuthorityState — the contract, not the agent, owns prior spend and the action count.',
      },
      {
        label: 'Settle',
        body: 'Only a proof that passes both checks releases the payment. The contract then writes the new state, marks the nullifier, transfers the asset, and emits a Verifiable Action Receipt.',
      },
      {
        label: 'The rules never leave the machine',
        body: 'Spend limits, the vendor allowlist, the invoice pre-image and the policy salt are private inputs. What reaches the chain is a Poseidon commitment, a Merkle root, and 14 public signals.',
      },
    ],
    stat: {
      value: '14 public signals',
      caption: 'The entire public surface of a proof. Everything else stays in the prover, in the user’s browser.',
    },
    note: 'The scope is deliberately narrow: Zentra is a proof-of-compliance and settlement layer, not an identity system, an oracle, a policy author, or a key manager (docs/start-here/what-zentra-is-not).',
  },

  {
    id: 'how-it-works',
    eyebrow: 'HOW IT WORKS',
    title: 'Commit, prove, verify, settle.',
    lead: 'Four steps, one of which the agent cannot fake and one of which the chain will not skip.',
    bullets: [
      {
        label: '01 · Commit the policy',
        body: 'The policy is authored off-chain; `commitPolicy` registers a Poseidon commitment of the rules plus a Merkle root of the approved recipients. The chain stores a fingerprint, never the policy.',
      },
      {
        label: '02 · Prove the action',
        body: 'The SDK reads the agent’s `AuthorityState`, derives the effective prior state for the current epoch, and snarkjs builds a proof binding policy, recipient, amount, prior state and a fresh nullifier. On the wire the proof is 256 bytes.',
      },
      {
        label: '03 · Verify on-chain',
        body: '`authorize_action` runs `require_auth(agent)`, asserts the proof’s `prev_*` values equal the on-chain state, rejects a used nullifier, folds the 14 public signals into `vk_x` with a BN254 multi-scalar multiplication, and evaluates one multi-pairing equation.',
      },
      {
        label: '04 · Settle and receipt',
        body: 'On success the contract writes the new state, marks the nullifier, transfers from agent to recipient, computes the Poseidon `action_id` and emits an `ActionReceipt`. On failure nothing moves.',
      },
    ],
    note: 'The loop is documented at /docs/how-it-works/overview. The verifier contract itself lives in the zentra-protocol repository; nothing in this app invokes it today, and the on-chain step above describes that contract, not the proof registry this site anchors to.',
  },

  {
    id: 'why-now',
    eyebrow: 'WHY NOW',
    title: 'The host functions landed. The verifier became affordable.',
    lead: 'On-chain Groth16 verification on Soroban was a paper design until two protocol upgrades shipped the primitives it needs.',
    bullets: [
      {
        label: 'Protocol 25 — “X-Ray”',
        body: 'CAP-0074 added BN254 host functions: point addition, scalar multiplication, and the multi-pairing check — exactly the primitives a Groth16 verifier needs. CAP-0075 added Poseidon / Poseidon2 permutations, so the hash the circuit uses can be recomputed natively inside the contract.',
      },
      {
        label: 'Protocol 26 — “Yardstick”',
        body: 'CAP-80 added BN254 multi-scalar multiplication and scalar-field arithmetic, which is how the 14 public inputs are aggregated into `vk_x` without exhausting the transaction budget.',
      },
      {
        label: 'No workaround stack',
        body: 'The result is the natural stack — Circom over BN254, circomlib Poseidon, snarkjs Groth16 — verified by a Soroban contract calling the host functions directly. No BLS12-381 substitute, no mocked verifier, no trusted off-chain step.',
      },
      {
        label: 'The window',
        body: 'The primitive is new enough that almost nothing is built on it and mature enough to build a product on. That gap is the reason to do this now rather than later.',
      },
    ],
    stat: {
      value: `${protocol.cpuBudget} CPU`,
      caption: 'What the repo reports for a full on-chain verification — the MSM plus the multi-pairing — against the per-transaction budget on testnet.',
    },
    note: `The ${protocol.cpuBudget} figure is quoted, not re-measured for this deck: it is recorded in src/config/protocol.ts and stated in the zentra-protocol README as the cost of verifying a real proof against the 100M per-transaction budget on testnet, measured against the verifier in that repository. Nothing in this application re-verifies a pairing on-chain today.`,
  },

  {
    id: 'market',
    eyebrow: 'MARKET',
    title: 'Whoever hands an agent a wallet inherits this problem.',
    lead: 'The buyers are the teams already shipping agents that spend. They have identity and they have permissions; the action-level check is the piece nobody has.',
    bullets: [
      {
        label: 'Agent frameworks and orchestrators',
        body: 'They need a constraint their users can trust. Today the allowlist is application code running in the same process the attacker is talking to.',
      },
      {
        label: 'AI-native fintech and spend management',
        body: 'Approval workflow is process, not cryptography. A proof is a control that still holds when the agent is wrong.',
      },
      {
        label: 'Treasury and procurement automation',
        body: 'The policy itself is confidential — vendor terms, counterparties, limits. Having to disclose it in order to get it enforced is the trade Zentra removes.',
      },
      {
        label: 'Machine-payment rails',
        body: 'x402-style paid APIs and per-request settlement assume no human in the loop. Nothing in that path checks that the payment obeyed the payer’s policy.',
      },
      {
        label: 'What none of them have',
        body: 'A way to state that one specific action was compliant, that a third party can verify without ever being shown the rules.',
      },
    ],
    note: 'No market size is claimed on this slide. The buyer categories are inferred from the protocol’s own design targets and roadmap — contract calls, treasury actions, API payments — not from third-party research or customer interviews. Any sizing used in a live conversation should carry a source; none is asserted here, and any illustrative figure raised in the room should be treated as illustrative.',
  },

  {
    id: 'traction',
    eyebrow: 'TRACTION',
    title: 'Live on testnet, with real wallets attached.',
    lead: 'Everything below is deployed and reproducible by a stranger with a Freighter wallet.',
    bullets: [
      {
        label: 'Four Soroban contracts on testnet',
        body: `Action Log v2 (${actionLog.contractId}), Reputation (${actionLog.reputationId}), Feedback (${actionLog.feedbackId}) and the Proof Registry (${actionLog.proofRegistryId}). Every recorded action makes a cross-contract call into reputation, so a score accrues from actions rather than claims.`,
      },
      {
        label: 'A working dApp, not a mock',
        body: 'Connect and disconnect across six wallets, live XLM balances, real testnet payments, an on-chain action board with an event-driven feed, and a /metrics dashboard reading distinct wallets and total actions straight from the contracts.',
      },
      {
        label: 'Groth16 in the browser',
        body: 'The playground runs the real payment-policy circuit in a Web Worker — roughly 3 s to prove, 0.4 s to verify, 14 public signals — then anchors a SHA-256 commitment of those signals to the proof registry through the visitor’s own wallet.',
      },
      {
        label: 'Real feedback from real wallets',
        body: '14 submissions from 12 distinct wallets, 13 of them anchored on-chain and one withheld by moderation. An on-chain claim only counts once its transaction hash resolves against Horizon and proves to have come from the claiming wallet.',
      },
      {
        label: 'Tested and in CI',
        body: '201 frontend tests (Vitest) and 14 Rust contract tests across all four contracts run on every push, alongside a typecheck and a production build.',
      },
    ],
    stat: {
      value: '5.00 / 5',
      caption: '13 published submissions from 12 distinct wallets; 13 anchored on-chain to the feedback contract.',
    },
    note: 'Testnet only and unaudited. The feedback figures are a snapshot — /metrics recomputes them live — and cover published submissions only: one abusive entry is withheld by moderation and excluded from both the count and the average. The distinct-wallet count is a lower bound, derived from the 20 most recent action-log entries and feedback authors. The 201 Vitest tests cover pure modules only; there are no component or end-to-end tests. Anchoring is a commitment, not on-chain re-verification: the deployed verifying key predates the current circuit build.',
  },

  {
    id: 'architecture',
    eyebrow: 'ARCHITECTURE',
    title: 'Three tiers, one deploy, no server-side keys.',
    lead: 'One Next.js 16 application serves the landing page, the docs, the dApp and the API; four Rust contracts sit under it on testnet. The browser is the only client of both the API and the chain.',
    bullets: [
      {
        label: 'Browser tier',
        body: 'React client components, the Stellar Wallets Kit across six wallets, and snarkjs Groth16 in a Web Worker. The witness — the private policy and its salts — never leaves the machine, and there is no server-side wallet, no server-side signing, and no backend indexer anywhere in the system.',
      },
      {
        label: 'Serverless tier',
        body: 'Next route handlers on Vercel over Neon Postgres via its HTTP driver. Every endpoint is defined through one `route()` wrapper, so a request id, exactly one structured JSON log line, and a single error envelope cannot be forgotten or reinvented per handler.',
      },
      {
        label: 'Chain tier',
        body: 'Four `#![no_std]` soroban-sdk contracts reached directly from the browser over Soroban RPC and Horizon. Contract ids are compile-time constants in `src/config`, so no id is hardcoded in prose and one redeploy updates every surface.',
      },
      {
        label: 'Production posture',
        body: 'A real validation boundary (4 KB body ceiling checked twice, every field error collected into one 422, the object rebuilt key by key so no caller-supplied field reaches the database), rate limits of 60 reads/min and 5 writes/10 min, secret redaction in logs, an error envelope that collapses any unknown throw to a generic 500, and HSTS, nosniff, frame-ancestors none, Referrer-Policy and Permissions-Policy headers.',
      },
      {
        label: 'Defence in depth',
        body: 'The database repeats the API’s rules as named CHECK constraints and a unique partial index, so a bug in the validation layer cannot corrupt the table — and a claimed on-chain transaction hash is re-resolved against Horizon before it earns the badge.',
      },
    ],
    note: 'The limits are written down rather than papered over (docs/ARCHITECTURE.md §9): the rate limiter is in-memory and therefore per-instance — a spam speed bump, not a security control; the feedback endpoints are unauthenticated; there is no `script-src` CSP because WebAssembly proving needs `wasm-unsafe-eval`; and chain reads are uncached, hitting public testnet RPC directly from the browser.',
  },

  {
    id: 'growth',
    eyebrow: 'GROWTH',
    title: 'From a reader to a wallet interaction, on the same site.',
    lead: 'The product is its own funnel: the docs bring people in, the playground gives them something to do, and the wallet steps turn a visitor into an on-chain participant.',
    bullets: [
      {
        label: 'An onboarding registry, not a mailing list',
        body: 'A `users` table keyed to a Stellar wallet — name, email, wallet, an optional rating and note, and a source of site, form or import — with unique indexes on email and on wallet so one person cannot be counted twice. Signups become a countable cohort instead of an anecdote.',
      },
      {
        label: 'Guided three-step setup',
        body: 'The /app page walks a fresh browser through installing Freighter, switching it to Test Net, and funding from Friendbot, marking each step against observable wallet state and collapsing to one line once connected. That sequence is where first-time users otherwise drop off.',
      },
      {
        label: 'The playground as the hook',
        body: 'A real proof generated in the visitor’s own browser, with annotated public signals, a private-versus-public split, a Merkle-membership visual and a glossary — then one button to anchor it on-chain, which converts a reader into a wallet interaction and a live feed entry.',
      },
      {
        label: 'Docs as top-of-funnel',
        body: '34 statically generated MDX pages with Orama search, a sitemap and robots — written to be found by someone searching for agent spending controls, not for Zentra by name.',
      },
      {
        label: 'Community distribution',
        body: 'A demo video, engineering write-ups on the blog, and five Stellar hackathon belt submissions all pointing at the same live product rather than at five demos.',
      },
    ],
    note: 'This is the built surface and the plan, not measured performance: there is no funnel data, no paid acquisition, and no retention curve yet. The onboarding registry is live — the /join signup writes to the users table through POST /api/onboard, and /join shows real progress against the 50-user goal.',
  },

  {
    id: 'roadmap',
    eyebrow: 'ROADMAP',
    title: 'From a proof-gated payment to an agent trust stack.',
    lead: 'v0.1 is live on testnet. Everything after it is articulated in the repo as versions, not as dates.',
    bullets: [
      {
        label: 'Near — harden what exists',
        body: 'Rebuild the deployed verifying key against the current circuit and re-verify the Groth16 pairing on-chain; that work is gated on the `soroban_poseidon` host-function dependency. Then v0.2: composable, versioned, revocable policies, a TypeScript policy DSL, and policy templates.',
      },
      {
        label: 'Mid — beyond payments',
        body: 'Contract calls, treasury actions, API payments and workflow approvals as provable actions; composable multi-policy authority; on-chain CAP-0075 Poseidon receipt hashing so the contract itself computes the receipt id.',
      },
      {
        label: 'Long — identity and reputation',
        body: 'An ERC-8004 / stellar8004 connector turning Verifiable Action Receipts into portable agent reputation, and ERC-7715-style scoped wallet permissions — converging on one place for identity, permission, compliance, settlement and reputation.',
      },
      {
        label: 'Under research',
        body: 'Noir and RISC Zero proving backends, recursive proof aggregation, and multi-asset settlement.',
      },
    ],
    note: 'No dates appear here because the repo gives none: the roadmap is versioned v0.2 through v1.0 and every stage past v0.1 is marked Planned. Ordering is intent, not a commitment.',
  },

  {
    id: 'ask',
    eyebrow: 'THE ASK',
    title: 'What would move this from testnet to production.',
    lead: 'Three things, in the order they matter.',
    bullets: [
      {
        label: 'Ecosystem support',
        body: 'Stellar ecosystem backing to keep the protocol work funded, and a line to the protocol team on BN254 and Poseidon host-function behaviour while the verifier is rebuilt against the current circuit.',
      },
      {
        label: 'Design partners',
        body: 'A handful of teams building agent frameworks or agentic-payment rails, willing to encode one real policy against testnet and say where the model breaks. Adversarial feedback is worth more than another feature.',
      },
      {
        label: 'Mainnet readiness',
        body: 'A security audit of the verifier and the settlement path, and a proper verifying-key management story: who owns the key, how a circuit upgrade is rolled out, how a stale key is revoked. The current deployment has a verifying key older than its circuit — precisely the failure mode to solve before real funds are involved.',
      },
      {
        label: 'What is not being asked',
        body: 'Nobody should put real money behind this yet. The ask is for the work and the scrutiny that would make that defensible.',
      },
    ],
    stat: {
      value: 'Testnet, unaudited',
      caption: 'The honest status today. The ask is exactly what it takes to change it.',
    },
    note: 'The code, the contracts and the limitations quoted throughout this deck are public: github.com/ALGOREX-PH/zentra-docs (dApp, contracts, tests, CI) and github.com/ALGOREX-PH/zentra-protocol (circuit, verifier, SDK, CLI).',
  },
];
