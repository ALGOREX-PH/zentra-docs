# Zentra Docs — HTTP API Reference

Three endpoints back the site: two for the feedback widget on `/metrics`, one
readiness probe. Base URL in production is `https://zentra-docs.vercel.app`.

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
| `GET /api/health` (200 / 503) | `no-store` |
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
| `validation_failed` | 422 | One or more fields failed validation. Every failing field is reported in `details` in a single response. |
| `conflict` | 409 | The `tx_hash` has already been recorded — the partial unique index raised Postgres `23505`. |
| `payload_too_large` | 413 | Request body exceeds 4096 bytes, by declared `content-length` or by measured UTF-8 length. |
| `rate_limited` | 429 | The caller exceeded the window for that route. Carries `Retry-After`. |
| `upstream_unavailable` | 503 | A database read or write failed. The real driver error is logged, never returned. |
| `internal` | 500 | Anything thrown that is not an `ApiError`. Message and stack are withheld because they may quote connection strings or query fragments. |
| `not_found` | — | Declared in the `ApiErrorCode` union but not produced by any current route. |
| `method_not_allowed` | — | Declared in the `ApiErrorCode` union but not produced by any current route. |

---

## 4. Rate limiting

Limits are per client key, which is the route scope plus the best available
client IP: first hop of `x-forwarded-for`, else `x-real-ip`, else
`cf-connecting-ip`, else the literal `unknown`. The raw header value is never
returned or logged.

| Endpoint | Scope | Limit | Window |
| --- | --- | --- | --- |
| `GET /api/feedback` | `feedback:read` | 60 requests | 60 s |
| `POST /api/feedback` | `feedback:write` | 5 requests | 10 min |
| `GET /api/health` | none | unlimited | — |

Successful responses from the two feedback routes carry:

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

## 5. Endpoints

### GET /api/feedback

Returns the aggregate rating summary plus the most recent 10 comments. This is
what the `/metrics` dashboard renders.

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
| `onChain` | boolean | no | Coerced with `Boolean()`, then **downgraded to `false` unless a valid `txHash` was supplied**. An unverifiable claim is quietly downgraded, not rejected. |

Unknown keys are ignored: the validated value is rebuilt field by field, so
nothing caller-supplied reaches the database. The whole body is capped at
**4096 bytes** — `content-length` is checked before the stream is read, then
the decoded text is measured again in case that header was absent or lying.

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

### GET /api/health

Readiness probe for uptime monitors, load balancers and deploy gates. It
reports whether the instance can actually serve traffic, not merely whether the
process is listening: it round-trips `SELECT 1` against Postgres and reports
the latency. The probe is capped at **2000 ms**; a slower response counts as a
failure.

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
  "uptimeSeconds": 3812,
  "checks": {
    "database": { "status": "ok", "latencyMs": 24 }
  }
}
```

**Degraded — `503 Service Unavailable`**

```json
{
  "status": "degraded",
  "requestId": "9f1c0f6a-2b31-4a35-9a1d-2f0f4d5e6c77",
  "uptimeSeconds": 3812,
  "checks": {
    "database": { "status": "error", "latencyMs": 0, "error": "unavailable" }
  }
}
```

The 503 body is the **normal** health body, not the error envelope — the route
degrades rather than throws. `latencyMs` is `0` when the check never completed,
and `error` is always the fixed string `unavailable`: a missing `DATABASE_URL`,
a refused connection and a hung socket are indistinguishable to the client. The
real cause is written to the server log under the same `requestId`.

The body is safe to expose publicly: no environment variables, versions,
hostnames, region names or dependency URLs.

| Status | Meaning |
| --- | --- |
| 200 | Every check passed. |
| 503 | At least one check failed. |
| 500 | `internal` envelope, only if the handler itself throws. |

---

## 6. Data model

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

### Indexes

| Index | Purpose |
| --- | --- |
| `feedback_created_at_desc_idx` | Serves the `ORDER BY created_at DESC LIMIT 10` recent list. |
| `feedback_on_chain_tx_hash_idx` | Partial (`WHERE on_chain`); serves the on-chain count. |
| `feedback_wallet_idx` | Partial (`WHERE wallet IS NOT NULL`); per-wallet lookups. |
| `feedback_tx_hash_unique_idx` | **Unique**, partial (`WHERE tx_hash IS NOT NULL`); one row per anchoring transaction. Its violation is what becomes the API's 409. |

The API layer and the database enforce the same rules independently. The
validation in `src/lib/api/validation.ts` exists to produce a useful 422; the
CHECK constraints exist so a bug in that layer cannot corrupt the table.

---

## 7. Operations

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
| `feedback.read` / `feedback.write` | feedback route | The real database error, at `error` level, when a query fails. |
| `health.database` | `GET /api/health` | The real cause behind a degraded probe. |

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
healthy answer. When an alarm fires, take `requestId` from the body and search
the logs for the matching `health.database` line to see the real cause.

---

## 8. Known limits

- **Rate limiting is per instance.** Counters live in one process's memory.
  With several concurrent Vercel instances the effective global ceiling is
  roughly `limit × instances`, and an instance that scales to zero forgets its
  counters. It is a spam speed bump, not a security control. A shared store
  (Redis/Upstash) is the fix when traffic justifies it.
- **The feedback endpoints are unauthenticated.** This is deliberate — it is
  public feedback, and requiring an account would defeat the point. A `wallet`
  in the body is self-reported and is not proof of key ownership; only a
  `txHash` that resolves on-chain is. Anything stronger needs signed payloads.
- **`CREATE TABLE IF NOT EXISTS` will not retrofit constraints.** Re-running
  `db/schema.sql` against a database where `feedback` already exists is a no-op
  for the table body: new CHECK constraints and column changes are *not*
  applied. Only the `CREATE INDEX IF NOT EXISTS` statements add anything. An
  existing database needs explicit `ALTER TABLE ... ADD CONSTRAINT` statements.
  `db/migrations/001_harden_feedback.sql` is exactly that: it normalises the
  affected columns, adds all five constraints `NOT VALID` so they guard new
  writes without locking the table for a full scan, and documents the
  `VALIDATE CONSTRAINT` step to promote them once the historical rows check out.
- **`x-request-id` is caller-controlled.** It is echoed as sent (capped at 200
  characters) and is a correlation aid, not an authenticated identifier.
