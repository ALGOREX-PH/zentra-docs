# Zentra — Stellar Belt Submission Checklist

One public repo (`github.com/ALGOREX-PH/zentra-docs`, branch `Setup-1`), one live
site (`https://zentra-docs.vercel.app`). Each belt is a route in the same product.

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
- [ ] Demo video (1–2 min) — record on `/board` with your wallet

> Remaining: the demo video.

---

## 🟢 Green Belt — Level 4 · Production MVP + real users

**Focus:** production MVP, onboarding, analytics/monitoring, feedback, validation

**Route:** [`/metrics`](https://zentra-docs.vercel.app/metrics) · analytics + hybrid feedback

**Requirements**
- [x] Production-ready MVP (stable frontend + contracts)
- [x] Mobile responsive UI
- [x] Loading states & error handling
- [x] Analytics & monitoring (Vercel Web Analytics + Speed Insights + `/metrics`)
- [x] User feedback collection + summary (Neon Postgres + on-chain `zentra-feedback`)
- [x] Backend architecture (Next.js API route + Neon serverless Postgres)
- [x] On-chain proof-of-interactions surface (`/metrics`)
- [ ] 10+ real users onboarded — real people you bring (I won't fabricate users)

**Submission**
- [x] Public repo · README · 15+ commits · live demo · contract addresses
- [x] Feedback contract — `CC6S6CKPWKUUH6NDLAENAGBN3EBZNO4GXZ7SLIJ4O3OK2I6U6K5F4CUG`
- [x] Screenshot — product UI (`docs/screenshots/product-ui.png`)
- [x] Screenshot — mobile responsive (`docs/screenshots/mobile.png`)
- [x] Screenshot — analytics / monitoring (`docs/screenshots/metrics.png`)
- [x] Basic user feedback summary (live on `/metrics`)
- [ ] Demo video
- [ ] Proof of 10+ user wallet interactions — real people (auto-counts on `/metrics`)

> Built & live. Remaining are the two things only real people can produce: 10+
> real users interacting, and the demo video.
