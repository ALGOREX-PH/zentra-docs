# Security Policy

## Current status

**Zentra runs on Stellar testnet only, and has not been independently audited.**

Both halves of that sentence matter for how you should read the rest of this
document:

- **Nothing here holds real value.** Testnet lumens are free and worthless. There
  are no user funds at risk today, and a vulnerability in a deployed contract
  cannot cost anyone money right now.
- **No independent audit has been performed.** `docs/SECURITY-REVIEW.md` is an
  internal review written by the same people who wrote the code. It is not an
  audit and does not stand in for one. Assume unfound bugs exist.

A mainnet deployment is not scheduled. When one is prepared, an independent audit
is a hard gate — see `docs/MAINNET.md` §2.

That is exactly why reports are valuable now: a bug found before mainnet costs
nothing to fix, and a bug found after it may have no on-chain remedy at all.

---

## Reporting a vulnerability

**Do not open a public issue, pull request, or discussion for a security
problem.** Do not post it on social media before it is fixed.

### Preferred: GitHub private security advisory

Report privately through GitHub's private vulnerability reporting on this
repository:

**https://github.com/ALGOREX-PH/zentra-docs/security/advisories/new**

Or: the repository's **Security** tab → **Report a vulnerability**.

This is the preferred channel because the report, the discussion, the fix and the
eventual disclosure all stay in one private thread that only you and the
maintainers can see, and because it needs no shared secret to be established
first.

### Alternative: email

> **Security contact: _[MAINTAINER: fill in a security contact address here
> before publishing this policy. Do not use a personal inbox that nobody
> monitors. Delete this note once the address is set.]_**

Until that address is filled in, the GitHub advisory link above is the only
supported private channel. Use it.

### If you want encryption

There is no published PGP key. If you need one before sending details, open a
GitHub advisory saying so — without the details — and a key can be exchanged
there.

---

## Scope

### In scope

| Area | What that covers |
| --- | --- |
| **`contracts/zentra-action-log`** | Soroban contract: `record`, `get_count`, `get_entry`, `get_recent`, `reputation`, the constructor, and the cross-contract call into reputation |
| **`contracts/zentra-reputation`** | Soroban contract: `set_logger`, `bump`, `score_of`, the constructor, and the admin/logger authorization model |
| **`contracts/zentra-feedback`** | Soroban contract: `submit`, `get_count`, `summary`, `get_recent` |
| **`contracts/zentra-proof-registry`** | Soroban contract: `anchor`, `get_count`, `get_recent` |
| **The HTTP API** | Every route under `src/app/api/` — feedback, onboard, health, search, and the `/api/admin/*` routes. Documented in `docs/API.md` |
| **The dApp and site** | The Next.js application in `src/` — wallet integration, transaction construction, the in-browser Groth16 prover, and the rendered docs |
| **The database layer** | `db/schema.sql`, `db/migrations/`, and the query paths in `src/lib/db.ts` and the route handlers |
| **CI and build configuration** | `.github/workflows/ci.yml`, `contracts/deploy.sh`, and anything that could inject code into a build |

Findings that are especially welcome, because they are where the design is
thinnest:

- Anything that lets an account other than the registered action log call
  `Reputation::bump`, or that bypasses `admin.require_auth()` on `set_logger`.
- Anything that gets past validation, rate limiting, or the moderation filter on
  the public feedback feed.
- Anything that reaches `/api/admin/*` without the configured `ADMIN_TOKEN`, or
  that leaks the registry's names and email addresses.
- Anything that causes the app to build or sign a transaction the user did not
  intend, or to sign against the wrong network.
- SQL injection, secret leakage in logs or error responses, or a dependency
  supply-chain path into the build.

### Out of scope

| Not in scope | Why |
| --- | --- |
| **Testnet funds** | Testnet lumens are free and have no value. "An attacker could drain testnet XLM" is not a vulnerability. The underlying flaw may still be one — report the flaw, not the loss |
| **Third-party services** | Vercel, Neon, Freighter and other wallets, Stellar Horizon and Soroban RPC, stellar.expert, GitHub. Report those to their own programmes. A misconfiguration *on our side* of one of those services is in scope |
| **The `zentra-protocol` repository** | `github.com/ALGOREX-PH/zentra-protocol` (circuit, SDK, CLI) is a separate project with its own tree. Report issues there, against that repository |
| **The Stellar network or Soroban itself** | Protocol-level issues belong to the Stellar Development Foundation |
| **Findings that require access you should not have** | A compromised maintainer laptop, a stolen deploy key, or physical access. Report it as an incident, but it is not a vulnerability in this code |
| **Reports with no demonstrated impact** | Missing security headers, an outdated dependency with no reachable exploit path, a scanner output with no analysis, "no rate limit" on an endpoint that has one, self-XSS, or clickjacking on a page with no state-changing action. Show the impact and it becomes in scope |
| **Volumetric attacks** | Do not run load tests, denial-of-service attempts, or automated scanners against the deployed site. See safe harbour below |

---

## What happens after you report

These are **intentions**, stated honestly. This is a small project without a
staffed security team, and this section is a description of how it means to
behave rather than a contractual guarantee.

| Stage | Intended timeline |
| --- | --- |
| Acknowledgement that the report was received | Within **3 business days** |
| Initial assessment — is it valid, how severe | Within **7 days** of acknowledgement |
| Fix for a critical or high-severity finding | Within **30 days** of assessment |
| Fix for a medium or low-severity finding | Best effort, tracked publicly once it is safe to do so |
| Public disclosure | Coordinated with you, after a fix ships |

If you have not heard anything within 7 days, the report was probably missed
rather than ignored. Follow up in the same advisory thread.

Some findings cannot be fixed on that schedule, and it is better to say so than
to pretend otherwise. A contract already deployed on chain cannot be patched in
place — the contracts implement no upgrade or pause mechanism (`docs/MAINNET.md`
§11, decisions 1–3). A fix there means deploying a replacement contract and
migrating, and the response will say so plainly rather than quietly.

### Disclosure

Disclosure is coordinated. The intention is to publish the finding and the fix
once the fix has shipped, and to credit you by whatever name or handle you
choose — or not at all, if you would rather stay anonymous. Ask, and you will be
credited.

There is **no bug bounty programme** and no money. Nobody should spend serious
time here expecting to be paid. What is on offer is credit, a fast honest reply,
and a fix.

---

## Safe harbour

Research conducted in good faith under this policy is authorised, and this
project will not pursue or support legal action against you for it.

Good faith means, concretely:

1. You only test against **testnet**, your own accounts, and your own data.
2. You do not access, modify, or exfiltrate data belonging to anyone else —
   including the names and email addresses in the `users` registry. If you find a
   path to that data, stop at proof and report it; do not enumerate it.
3. You do not degrade the service for other people. No load testing, no
   denial-of-service, no automated scanning against the deployed site. Run those
   against a local checkout — `bun run dev` gives you the whole application.
4. You do not use social engineering, phishing, or physical intrusion against
   maintainers or providers.
5. You report promptly, give a reasonable window for a fix, and do not disclose
   publicly before then.
6. You stay within the scope above. Third-party services are covered by their
   own policies, not this one.

If you are unsure whether something is in bounds, ask first in an advisory
thread. Asking is always fine.

Nothing here can waive the rights of third parties, and this policy cannot
authorise testing against services this project does not control.

---

## What a good report contains

The more of this you include, the faster the reply is useful. A report missing
reproduction steps mostly generates questions.

1. **A one-line summary.** What breaks, and for whom.
2. **Where.** The file and function, the contract and method, or the endpoint and
   HTTP method. A commit SHA or a permalink is ideal, since the tree moves.
3. **Which environment.** The deployed site (name the URL), a local checkout, or
   a contract on testnet (give the contract id).
4. **Reproduction steps.** Numbered, exact, from a clean state. Include the
   request or the `stellar contract invoke` command, and the response you got.
5. **Impact.** What an attacker actually gains — not the CVSS score, the outcome.
   "Any account can call `bump` directly and inflate its own score" beats
   "authorization issue".
6. **Preconditions.** What the attacker needs first: a connected wallet, an
   `ADMIN_TOKEN`, a specific contract state, a race with another user.
7. **Evidence.** A transaction hash, a response body, a log excerpt, a short
   screenshot or clip. Redact anything belonging to someone else.
8. **A suggested fix, if you have one.** Optional and genuinely appreciated.

A note on the last point: do not attach a pull request to a security report. A PR
is public, and the diff discloses the vulnerability before the fix has shipped.
Describe the fix in the advisory instead, and a patch can be coordinated
privately from there.

---

## For people reading the code

If you are reviewing rather than reporting, these are the useful entry points:

| Document | What it covers |
| --- | --- |
| `docs/ARCHITECTURE.md` | The three tiers, the trust boundaries, and what the server can and cannot do |
| `docs/API.md` | Every endpoint, its validation, its rate limits, and its error envelope |
| `docs/SECURITY-REVIEW.md` | The internal review — its own scope and its own limits |
| `docs/MAINNET.md` | The mainnet preparation runbook, including the unresolved security decisions in §11 |

Two design facts worth knowing before you start, because they rule out whole
classes of finding:

- **The server holds no signing key.** Transactions are built in the browser,
  signed by the user's own wallet extension, and submitted as signed XDR. There
  is no server-side wallet and no key to steal — `.env.example` documents this as
  a deliberate absence.
- **`ADMIN_TOKEN` fails closed.** If it is unset or empty, every `/api/admin/*`
  route denies with `503`. A missing secret never means "open".
