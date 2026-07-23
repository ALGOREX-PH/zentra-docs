# Zentra — launch kit

Copy for the Blue Belt launch: a Twitter/X thread, a short-form variant, a
showcase asset plan, an ecosystem posting plan, and the claims that must not be
made. Nothing here is published automatically — this is a draft for the
maintainer to check and post.

Every factual claim below is traceable to something in this repository:
`README.md`, `src/lib/pitch.ts`, `docs/ARCHITECTURE.md`, `docs/BELT-CHECKLIST.md`,
`src/config/contract.ts`, `src/config/protocol.ts`. Where the repo hedges, the
copy hedges. See [§6 Messaging guardrails](#6-messaging-guardrails).

---

## 1. Before you post

Work down this list. Anything unchecked is a claim you cannot make yet.

**Links — open each one, in a logged-out browser, on a phone.**

- [ ] `https://zentra-docs.vercel.app` (landing)
- [ ] `/app` · `/board` · `/metrics` · `/playground` · `/join` · `/pitch` · `/roadmap` · `/docs`
- [ ] `/api/health` returns `200`
- [ ] The four contract links on stellar.expert resolve and show recent activity
- [ ] `https://github.com/ALGOREX-PH/zentra-docs` is public and its README renders
- [ ] `https://youtu.be/JQapGdfgZJw` plays in a private window (not "Unlisted"
      by accident, not region-blocked, not still processing)

**Facts.**

- [ ] Contract ids in the thread match `src/config/contract.ts` exactly —
      Action Log v2 `CCSXFTQT…ZDDES`, Reputation `CA2QOMGV…IIPI`,
      Feedback `CC6S6CKP…F4CUG`, Proof Registry `CBSGDR6W…TSHS`.
      Do **not** quote `CDDIQNNC…FK7VY` (superseded v1) or
      `CDS6BURF…K7VY` (the ZentraVerifier — its source is in `zentra-protocol`
      and nothing in this app invokes it).
- [ ] `/metrics` is loading live numbers, not an error state. If it is erroring,
      cut every "live on-chain" line from the copy until it is fixed.
- [ ] Reconcile the test count before anyone quotes it: `README.md` and
      `docs/BELT-CHECKLIST.md` say **201** Vitest tests, `docs/ARCHITECTURE.md`
      §9 says **131**. The thread avoids the number entirely; if you add it back,
      fix the docs first. A reviewer who finds the contradiction stops believing
      the rest.
- [x] `docs/articles/soroban-action-log-tutorial.md` exists — a full Soroban
      tutorial, and the strongest thing to lead with in developer channels. The
      dev.to plan in §5 is unblocked. It is linked from `/blog` as "Read it →".
- [ ] The `/blog` page is a single route; only the tutorial has an outbound
      link, and the three older cards have no permalinks. Do not link "the post
      about X" for those — link `/blog`
      or nothing.

**Network.**

- [ ] Say **testnet** explicitly, in the first tweet and in every standalone
      post. Recommendation: always. The entire value of this project to a
      technical reader is that its limits are stated rather than hidden — the
      README, the pitch deck and `docs/ARCHITECTURE.md` §9 all lead with
      "testnet, unaudited". Implying mainnet readiness contradicts your own
      repository, and the first engineer who checks will say so publicly. There
      is no upside that survives that.

**Media.**

- [ ] `public/og.png` is 2400 × 1260 (the metadata in `src/app/layout.tsx`
      declares 1200 × 630 — same 1.9:1 ratio, so it renders correctly, but the
      declared size is wrong; harmless, worth fixing).
- [ ] Post the OG card as an image attachment on tweet 1 rather than relying on
      link unfurling — X often drops the card when the tweet already has text and
      a link.

---

## 2. The launch thread (Twitter/X)

Character counts are noted in a comment beside each tweet and are computed the
way X counts: **any URL counts as 23 characters** regardless of length. Verify
each one in the composer before posting — do not trust the numbers below blindly.

No emoji are used. The copy does not need them and their absence reads as
confidence.

---

**1/9**

```
An AI agent with a wallet moves money at machine speed. Most controls today are trust before the action and a log after it.

Zentra makes the agent prove the payment obeyed your private rules — before it settles. Live on @StellarOrg testnet.

zentra-docs.vercel.app
```

<!-- 266 chars · standalone: states the problem, the mechanism, the network and the link -->
<!-- ATTACH: public/og.png here -->

**2/9**

```
Identity says who the agent is. Permissions say what it may touch. Neither answers the question that actually moves money:

Did this specific action, right now, follow the rules?

A signed transaction can't tell a correct payment from a prompt-injected one. A proof can.
```

<!-- 270 chars -->

**3/9**

```
Zentra is a zero-knowledge policy layer for agents on Stellar.

Before a payment moves, the agent generates a Groth16 proof that the action obeyed a private policy — vendor allowlist, per-invoice cap, daily limit — and a Soroban contract checks it.

The rules stay secret.
```

<!-- 273 chars -->

**4/9**

```
Prove → verify → settle.

1. The agent builds a Groth16/BN254 proof (Circom + snarkjs). The private policy never leaves the machine.
2. A Soroban contract checks it against the agent's on-chain state, so it can't lie about prior spend.
3. Only then does money move.
```

<!-- 265 chars · this is the protocol design; tweet 6 states what the live app actually does -->

**5/9**

```
Live on Stellar testnet right now, and reproducible with a Freighter wallet:

• 4 Soroban contracts deployed
• a multi-wallet dApp (6 wallets)
• an on-chain action board with a live event feed
• a /metrics dashboard reading straight from the contracts

zentra-docs.vercel.app/app
```

<!-- 276 chars -->
<!-- ATTACH: the 2-minute demo video here. Upload natively if it is under 2:20 — native video gets multiples of the reach of a YouTube link. If it is longer, post the youtu.be link on tweet 9 only and attach the 30-second silent playground capture (§4) here instead. -->

**6/9**

```
The playground runs the real Groth16 payment-policy circuit in your browser — ~3s to prove, 0.4s to verify, 14 public signals — then anchors the proof's SHA-256 commitment on-chain.

Anchoring is a commitment, not on-chain re-verification.

zentra-docs.vercel.app/playground
```

<!-- 265 chars · the second line is the single most important sentence in the thread — it is the claim a ZK engineer will test -->

**7/9**

```
Why this is possible now: Protocol 25 shipped BN254 host functions and Poseidon (CAP-0074/0075), Protocol 26 added BN254 MSM (CAP-80).

Groth16 verification inside a Soroban contract stopped being a paper design. #Stellar #Soroban
```

<!-- 230 chars -->

**8/9**

```
Status, plainly: testnet only, unaudited, a working proof-of-concept. Everything — contracts, dApp, tests, CI, and the documented limitations — is public.

github.com/ALGOREX-PH/zentra-docs
```

<!-- 180 chars · the limitations are in docs/ARCHITECTURE.md §9; linking them is the point -->

**9/9**

```
If you're building agents that spend — or breaking them — I'd like your adversarial feedback.

Generate a proof: zentra-docs.vercel.app/playground
2-min demo: youtu.be/JQapGdfgZJw

#AIagents #ZK
```

<!-- 187 chars -->

**Thread notes**

- Tags used: `@StellarOrg` once (tweet 1), `#Stellar #Soroban` (tweet 7),
  `#AIagents #ZK` (tweet 9). Two per tweet, five tweets carry none. Resist
  adding more.
- Do not tag individual Stellar employees in the thread. Reply to your own
  tweet 1 with the link once the thread is up if you want SDF to see it, or post
  it in Discord (§5) — that is the channel for it.
- If you only get one tweet read, it is tweet 1. It works alone.

---

## 3. Short-form variant

One standalone post for LinkedIn or the Stellar Developers Discord `#showcase`.
Slightly more formal, no thread structure, ~165 words.

```
Zentra — a zero-knowledge policy layer for AI agents on Stellar. Live on testnet.

The problem: agents are being handed spending authority, and the controls around
it are trust before the action and an audit log after it. A prompt-injected agent
produces a payment that is correctly signed, correctly authorized, and wrong.
Nothing in the signing path can tell the difference.

Zentra puts a proof in between. Before a payment moves, the agent generates a
Groth16 proof (Circom + snarkjs, BN254) that the action obeyed a private policy —
approved recipients, a per-invoice cap, a daily limit — and a Soroban contract
checks that proof against the agent's own on-chain state, so it cannot understate
what it has already spent. The rules stay private; the compliance is verifiable.

What is live today: four Soroban contracts on Stellar testnet, a multi-wallet
dApp, an on-chain action board, and a playground that generates a real Groth16
proof in your browser and anchors its commitment on-chain.

Testnet only and unaudited — a working proof-of-concept, with its limitations
documented in the repo. Adversarial feedback welcome.

https://zentra-docs.vercel.app · https://github.com/ALGOREX-PH/zentra-docs
```

For Discord, drop the last line's GitHub URL into a second message so the embed
does not eat the post.

---

## 4. Demo and showcase content

Three assets. Each one exists to close a specific doubt in a skeptical viewer's
head — if it does not do that, it is decoration.

### 4.1 The 2-minute walkthrough — recorded

`https://youtu.be/JQapGdfgZJw` · already exists · confirm it is public before
launch.

**Must prove:** a stranger can reproduce this. Not that it looks polished — that
it is real and it is theirs to try.

The strongest thirty seconds of it are the ones where a transaction hash appears
and then that hash is opened on stellar.expert. Anything that shows only your own
UI proves nothing; the explorer is a third party. If you re-record, make sure the
cut list is: connect a wallet → the balance is read from chain → a real testnet
payment settles with a hash → open the hash on stellar.expert → generate a proof
in the playground → anchor it → open the anchor tx on stellar.expert.

Say "testnet" out loud in the first fifteen seconds.

### 4.2 30-second silent screen capture — playground

**Must prove:** the proof is really being computed here, in this browser, right
now — not replayed from a fixture and not a canned animation.

- One unbroken take, no cuts, no zoom transitions. A cut is where a skeptic
  assumes the substitution happened.
- Capture the whole window, including the URL bar, so it is visibly the live site.
- Let the prove step take its real ~3 seconds. Do not trim the wait — the wait is
  the evidence. `src/lib/zk/prover.ts` reports the actual prove and verify timings
  and `ProofLab` never fabricates a result; show those numbers on screen.
- End on the 14 public signals and the local verification result. If you have 30
  seconds to spare, end instead on the anchor transaction opening in stellar.expert.
- Silent, with burned-in captions (2–4 short lines, e.g. "real Groth16 proof",
  "generated in this browser", "~3s"). Silent-and-captioned is what autoplays on
  X and LinkedIn feeds.

### 4.3 One annotated architecture image

**Must prove:** there is no hidden server doing the interesting part.

Base it on the mermaid diagram in `docs/ARCHITECTURE.md` §2 — three tiers:
browser (React, Stellar Wallets Kit, snarkjs in a Web Worker), serverless (Next
route handlers on Vercel, Neon Postgres), chain (four Soroban contracts on
testnet). Add four annotations:

1. On the browser tier: **"the private witness never leaves this box"**.
2. On the serverless tier: **"no wallet, no signing, no indexer"** — the server
   only touches the feedback table and a readiness probe.
3. On the arrow into the proof registry: **"anchors a SHA-256 commitment — not
   an on-chain pairing check"**.
4. Beside the chain tier: **"Stellar testnet"**, in the same weight as
   everything else, not in small print.

One image, PNG, legible at feed size on a phone. If a label is unreadable at
600px wide, cut the label.

---

## 5. Ecosystem engagement

The order matters: the technical channels first, while you can still fix what
they find; the broad channels after.

Universal rule: every one of these communities punishes pure promotion. Lead with
the technical artifact — a tutorial, a measurement, a limitation you hit — and let
the product be the footnote. "Here is how X works on Soroban, and here is where it
broke for me" gets read. "Introducing Zentra" gets scrolled past.

### Stellar Developers Discord

The primary channel. Post in `#showcase` (or the current equivalent) using the
short-form variant from §3.

- Ask a question you actually want answered rather than closing with a CTA. The
  honest one: whether anyone has rebuilt a Groth16 verifying key against a
  current circuit using the `soroban_poseidon` host function, since that
  dependency is exactly what gates the on-chain re-verification work
  (`src/lib/pitch.ts`, roadmap slide).
- If a dev-help channel is a better fit for that question, ask it there
  *separately*, without the product link. Two posts, two purposes.
- Answer replies for at least a day. A showcase post with an unanswered technical
  question underneath it is worse than no post.

### Stellar Dev Diaries / community channels

Dev Diaries and community roundups run on submissions, not discovery. Send a
short factual paragraph — what it is, what network, what is live, one link — and
let them edit. Do not send the thread; send the facts. Testnet status in the
first sentence, so nobody has to correct it after publication.

### Reddit — r/Stellar

Lower technical density than Discord, high sensitivity to self-promotion.

- Post once, as a text post, not a link post. Put the substance in the body.
- Frame it as what you built and what you learned on Stellar, not as a launch.
  A title like "I built a ZK policy layer for AI agents on Soroban testnet —
  here's what the BN254 host functions actually let you do" survives; "Introducing
  Zentra" does not.
- Disclose that you are the author in the first line. Reddit finds out anyway.
- Do not cross-post the same text to r/CryptoCurrency or similar. It reads as
  spam and it will be treated as such.

### dev.to

**Ready.** `docs/articles/soroban-action-log-tutorial.md` is written — a
full Soroban walkthrough with every snippet taken from this repo. Cross-post it:

- Cross-post the tutorial itself, in full. dev.to rewards complete, standalone,
  runnable content — a teaser with a "read more" link performs badly and reads as
  bait.
- Set `canonical_url` to the copy on your own site so you do not compete with
  yourself in search.
- Tags: `stellar`, `soroban`, `rust`, `webassembly` or `zeroknowledge` depending
  on the article's actual subject. Four maximum.
- The product mention belongs in one closing paragraph, after the reader already
  has something working.
- The same article is the natural Hacker News submission if you want one — but
  submit the tutorial, never the landing page, and expect the top comment to be
  about the verifying-key caveat. Have the honest answer ready (§6).

---

## 6. Messaging guardrails

These are drawn from the repository's own documented limitations. Each one is a
claim a technical reader can check in minutes, so the cost of getting it wrong is
immediate and public.

| Do not say | Say instead |
| --- | --- |
| "Live on Stellar." / anything that implies mainnet. | "Live on Stellar **testnet**." Every time, including the first tweet. |
| "Secure", "production-ready", "audited", "safe for funds". | "Unaudited, testnet only — a working proof-of-concept. An audit of the verifier and the settlement path is what mainnet needs." (`src/lib/pitch.ts`, ask slide.) |
| "Proofs are verified on-chain." / "the contract re-verifies your proof." | "The proof is generated and verified **client-side** with snarkjs, then its SHA-256 commitment is **anchored** on-chain. Anchoring is a commitment, not on-chain re-verification — the deployed verifying key predates the current circuit build, and rebuilding it is gated on the `soroban_poseidon` host function." (`docs/ARCHITECTURE.md` §9; `README.md`.) |
| "N wallets have used Zentra." | "`/metrics` shows distinct interacting wallets as a **lower bound** — it derives them from the 20 most recent action-log entries and feedback authors, because both contract reads are capped at `MAX_RECENT = 20`." (`docs/ARCHITECTURE.md` §9.) |
| Any market size, TAM, or "$X billion agentic payments market". | Name the buyer categories and stop. "No market size is claimed — the buyer categories are inferred from the protocol's own design targets, not from third-party research or customer interviews." (`src/lib/pitch.ts`, market slide.) |
| "Verification costs ~26M CPU." | Either omit it — the thread does — or attribute it: "the `zentra-protocol` repo reports ~26M of the 100M per-transaction budget for a full on-chain verification. That figure is quoted, not re-measured, and nothing in this application re-verifies a pairing on-chain today." |
| "50 users", "hundreds of testnet users", or any signup figure. | Nothing. `docs/users/onboarding-responses.csv` currently contains a header row and no data, and `docs/BELT-CHECKLIST.md` marks the 50-user and 10-user targets as open. Point at `/join` and let the live counter speak. |
| "Rated 5/5 by users." | If you use the feedback numbers at all, use them whole: "13 published submissions from 12 distinct wallets, average 5.00 — a snapshot; `/metrics` recomputes it live, one abusive entry is withheld by moderation and excluded from both the count and the average." Better: skip it. 13 submissions is not social proof, and quoting it invites the reader to notice how small it is. |
| "Fully tested." | Avoid a test count until `README.md` (201) and `docs/ARCHITECTURE.md` §9 (131) agree. Even then: "tests cover pure modules and the contracts; there are no component or end-to-end tests." |
| "Rate limited", "hardened", "enterprise-grade". | "The rate limiter is in-memory and per-instance — a spam speed bump, not a security control. The feedback endpoints are deliberately unauthenticated." (`docs/ARCHITECTURE.md` §9.) |
| "Zentra handles agent identity / permissions / key management." | "Zentra is a proof-of-compliance and settlement layer — not an identity system, an oracle, a policy author, or a key manager." (`/docs/start-here/what-zentra-is-not`.) |
| Dates for anything on the roadmap. | "The roadmap is versioned v0.2 → v1.0; everything past v0.1 is marked Planned. Ordering is intent, not a commitment." |

One more, less a phrasing than a posture: **when someone finds the
verifying-key caveat, agree with them immediately and link to where you wrote it
down**. It is in `README.md`, in `docs/ARCHITECTURE.md` §9, and on the pitch
deck's roadmap and ask slides. Being the person who documented their own weakest
point before anyone asked is worth more than the claim you would have made
instead.

---

## 7. Post-launch

**Watch, for the first 72 hours.**

- **Vercel Analytics → referrers.** Which channel actually sent people: X,
  Discord, Reddit, dev.to, YouTube. This is the only number that tells you where
  to spend the next round of effort. Expect Discord to convert better than X and
  X to send more raw traffic.
- **Vercel Analytics → pages.** The question is whether people who land on `/`
  reach `/playground`. If they do not, the landing page is the problem, not the
  distribution.
- **`/join` signups.** The registry is empty today, so every row is attributable
  to a specific post. Note the timestamp against when you posted where.
- **`/metrics`.** Distinct wallets and total on-chain actions. A visitor who
  connects a wallet and anchors a proof is worth more than a hundred readers, and
  this is the only surface that proves it happened. Screenshot it at launch so
  you have a before.
- **Speed Insights.** A traffic spike on a page that runs a 3-second WASM prove
  in a Web Worker is exactly when Core Web Vitals degrade. Check it on mobile.
- **Replies and issues.** Sort incoming feedback into: factual corrections (fix
  the docs same day and say so publicly), feature requests (the README's
  iteration table is the format — one row, one commit), and adversarial claims
  about the crypto (the most valuable category; answer them in public with a link
  to the code).

**Follow-ups, roughly in this order.**

1. **Same day:** reply to your own thread with anything you got wrong. A visible
   correction costs nothing and buys credibility.
2. **Within a week:** one technical post about a single thing you learned —
   the state-binding argument, or what the BN254 host functions do and do not
   let you do. Distribute it through dev.to and Discord, not another launch
   thread.
3. **When the numbers move:** a short update quoting the real `/metrics` figures,
   with the lower-bound caveat intact. Only post this if the numbers are
   genuinely interesting. Announcing four wallets is worse than announcing
   nothing.
4. **When the verifying key is rebuilt against the current circuit and the
   pairing is re-verified on-chain:** that is the next real launch. It converts
   every caveat in §6 into a claim. Save the energy for it.
