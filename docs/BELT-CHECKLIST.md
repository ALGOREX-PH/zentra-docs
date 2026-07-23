# Zentra — Stellar Belt Submission Checklist

One public repo (`github.com/ALGOREX-PH/zentra-docs`, branch `Setup-1`), one live
site (`https://zentra-docs.vercel.app`). Each belt is a route in the same product.

> ⚠️ **Submit `github.com/ALGOREX-PH/zentra-docs` for every belt** — not the
> `zentra-protocol` repo. zentra-protocol is the ZK protocol (circuits + verifier,
> **no wallet**) and fails the connect-wallet check; this repo has the contracts
> **and** the wallet dApp.

Legend: ✅ done · ⬜ pending (you) · 🔄 in progress

---

## 🥋 White Belt — Level 1 · First Stellar dApp

**Route:** [`/app`](https://zentra-docs.vercel.app/app) · Freighter · testnet payments

**Requirements**
- [x] Freighter wallet setup, Stellar Testnet
- [x] Wallet connect **and** disconnect
- [x] Fetch + display XLM balance
- [x] Send an XLM transaction
- [x] Transaction feedback (success / failure + tx hash)
- [x] Error handling (unfunded, bad address, low balance, rejected)
- [x] Friendbot fund button

**Submission**
- [x] Public GitHub repo
- [x] README (description + setup)
- [x] Screenshot — wallet connected (`docs/screenshots/connected.png`)
- [x] Screenshot — balance displayed (`docs/screenshots/balance.png`)
- [ ] Screenshot — successful testnet transaction (`transaction.png`) — needs a real signed send
- [ ] Screenshot — transaction result shown (`result.png`) — needs a real signed send

> Remaining: capture `transaction.png` + `result.png` from your own Freighter session.

---

## 🟡 Yellow Belt — Level 2 · Multi-wallet + deployed contract + events

**Route:** [`/board`](https://zentra-docs.vercel.app/board) · multi-wallet · on-chain action log

**Requirements**
- [x] Multi-wallet (Stellar Wallets Kit: Freighter, xBull, Albedo, LOBSTR, Hana, Rabet)
- [x] 3+ error types handled
- [x] Contract deployed on testnet
- [x] Contract called from the frontend (read + write)
- [x] Event listening / state sync (Soroban RPC `getEvents`)
- [x] Transaction status visible

**Submission**
- [x] Public repo · README · 2+ commits
- [x] Live demo link
- [x] Deployed contract address — `CDDIQNNCZ23UVM4FTEKNFUB72WHNASWOX2JRXED3HYK6FNZGZCHBQFK7`
- [x] Contract-call tx — `eb02d05b742721c2161dcd7ddb3cdcb5464d0cb31d1cb760a3647990510d00d7`
- [x] Screenshot — wallet options (`docs/screenshots/wallets.png`)

> Complete. (The `/board` contract was later upgraded to v2 for Orange Belt.)

---

## 🟠 Orange Belt — Level 3 · Advanced contracts + CI/CD + tests

**Route:** [`/board`](https://zentra-docs.vercel.app/board) v2 · two contracts · inter-contract calls

**Requirements**
- [x] Advanced smart contract development (constructor, admin, gated writes)
- [x] Inter-contract communication (`record` → `reputation.bump` via `#[contractclient]`)
- [x] Event streaming & real-time updates
- [x] CI/CD pipeline (`.github/workflows/ci.yml`)
- [x] Smart contract deployment workflow (`contracts/deploy.sh`)
- [x] Mobile responsive frontend
- [x] Error handling & loading states
- [x] Tests for contracts **and** frontend (Rust 3+5, Vitest 10 = 18)
- [x] Production-ready architecture
- [x] Documentation

**Submission**
- [x] Public repo · README · 10+ commits · live demo
- [x] Action Log v2 — `CCSXFTQTWVSHUMH2C64RJKY7JKCVHD5REFIW3P3YPVY6PWHVSJ7ZDDES`
- [x] Reputation — `CA2QOMGVQ5XWGFDYT5XEJ7EQ6B6H4ZNDAPS337P3BT55XY3DJY4AIIPI`
- [x] Cross-contract interaction tx — `fd50307244f94bc070fe8b2d84280b992781b2c7295dc5272d17bd1650da8587`
- [x] Screenshot — mobile responsive (`docs/screenshots/mobile.png`)
- [x] Screenshot — CI/CD running (`docs/screenshots/ci.png`)
- [x] Screenshot — test output, 3+ passing (`docs/screenshots/tests.png`)
- [x] Demo video — **[youtu.be/JQapGdfgZJw](https://youtu.be/JQapGdfgZJw)**

> Complete.

---

## 🟢 Green Belt — Level 4 · Production MVP + real users

**Focus:** production MVP, onboarding, analytics/monitoring, feedback, validation

**Route:** [`/metrics`](https://zentra-docs.vercel.app/metrics) · analytics + hybrid feedback

**Requirements**
- [x] Production-ready MVP (stable frontend + contracts)
- [x] Mobile responsive UI
- [x] Loading states & error handling (route skeleton, segment + root error
      boundaries, branded 404)
- [x] User onboarding (3-step Freighter → testnet → funding guide on `/app`)
- [x] Analytics & monitoring (Vercel Web Analytics + Speed Insights + `/metrics`)
- [x] User feedback collection + summary (Neon Postgres + on-chain `zentra-feedback`)
- [x] Backend architecture — layered API (`src/lib/api/`): one `route()` wrapper
      giving every endpoint request ids, structured JSON logs and a single error
      envelope; strict validation at the trust boundary; per-route rate limits;
      no driver message ever reaches a client
- [x] Database design (`db/schema.sql` + `db/migrations/`, named constraints,
      four query-serving indexes)
- [x] Security (CSP `frame-ancestors`, HSTS, nosniff, Referrer-Policy,
      Permissions-Policy; secret redaction in logs; 4 KB body ceiling)
- [x] Health / readiness endpoint (`/api/health`, 200 ok · 503 degraded)
- [x] API documentation (`docs/API.md`) + architecture (`docs/ARCHITECTURE.md`)
- [x] Automated tests — 131 frontend (Vitest) + 14 contract (Rust, all four
      contracts); CI runs typecheck, tests and build
- [x] On-chain claims verified server-side — a submitted `txHash` is resolved
      against Horizon and must exist, have succeeded, and belong to the claiming
      wallet before it counts as on-chain
- [x] On-chain proof-of-interactions surface (`/metrics`)
- [ ] 10+ real users onboarded — real people you bring (I won't fabricate users)

**Submission**
- [x] Public repo · README · 15+ commits · live demo · contract addresses
- [x] Feedback contract — `CC6S6CKPWKUUH6NDLAENAGBN3EBZNO4GXZ7SLIJ4O3OK2I6U6K5F4CUG`
- [x] Screenshot — product UI (`docs/screenshots/product-ui.png`)
- [x] Screenshot — mobile responsive (`docs/screenshots/mobile.png`)
- [x] Screenshot — analytics / monitoring (`docs/screenshots/metrics.png`)
- [x] Basic user feedback summary (live on `/metrics`)
- [x] Demo video — **[youtu.be/JQapGdfgZJw](https://youtu.be/JQapGdfgZJw)**
- [ ] Proof of 10+ user wallet interactions — real people (auto-counts on `/metrics`); first real anchor: [tx `0490a1e3…`](https://stellar.expert/explorer/testnet/tx/0490a1e32093c0d3cdb578a60d14caccbb4c4d05636d70eade54a89e091976a4)

> Built & live, demo recorded. The one remaining item only real people can produce:
> 10+ distinct wallets interacting — now under way (first real user anchor: `GA7A…5OQV`).

---

## ⭐ Bonus — real ZK proof playground

Beyond the belt requirements, [`/playground`](https://zentra-docs.vercel.app/playground)
generates a **real Groth16 / BN254 proof** in the browser (snarkjs + the payment-policy
circuit), verifies it locally, and **anchors it on-chain** to a proof-registry contract
`CBSGDR6WBOXHSRPDHOHY24DFHIJACY3DAK2MRRO6MLFRK7YUUBSNTSHS` with a live feed — plus a
beginner visual guide (animated flow, Merkle membership tree, annotated public signals,
glossary). A real user-anchored proof: [tx `0490a1e3…`](https://stellar.expert/explorer/testnet/tx/0490a1e32093c0d3cdb578a60d14caccbb4c4d05636d70eade54a89e091976a4).
