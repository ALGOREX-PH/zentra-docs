# Onboarding registry — collection, export, and what we do with it

The Blue Belt target is **50 testnet users**. This directory holds the exported
responses and the plan they feed.

**Current state: 0 of 50.** The `users` table is empty, and
[`onboarding-responses.csv`](onboarding-responses.csv) is its header row and
nothing else. Everything described below — both intake paths, the export, the
counter — is built and live; none of it has been used yet. That distinction is
the whole point of stating it: the mechanism working is not evidence that anyone
came through it.

- Exported sheet: [`onboarding-responses.csv`](onboarding-responses.csv) — header only
- Live signup: [`/join`](https://zentra-docs.vercel.app/join)
- Live progress: the counter on `/join` reads `GET /api/onboard`, which currently
  returns `0`

---

## The two intake paths

Both land in the same `users` table, distinguished by the `source` column, so
analysis never has to reconcile two formats.

| Path | `source` | How it arrives |
| --- | --- | --- |
| On-site signup at `/join` | `site` | `POST /api/onboard` writes straight to Postgres. The wallet field autofills from a connected wallet. |
| Google Form | `form` | Responses exported from Sheets, then imported (see below). |
| Backfill | `import` | Anything reconstructed from earlier activity. |

### The Google Form

For reaching people who will not visit the site first. Five questions, mapped to
the same columns the on-site path writes. The **Accepted** column is what
`parseUserInput` in [`src/lib/api/validation.ts`](../../src/lib/api/validation.ts)
enforces on `/join`. Every row is also backed by a `CHECK` constraint in
[`db/schema.sql`](../../db/schema.sql), so an imported row that does not satisfy
it is rejected by Postgres rather than quietly coerced — the one exception is the
254-character email cap, which is enforced in the route only:

| # | Question | Type | Required | Column | Accepted |
| --- | --- | --- | --- | --- | --- |
| 1 | Your name | Short answer | yes | `name` | 1–80 chars after whitespace is collapsed and control characters are stripped |
| 2 | Email address | Short answer | yes | `email` | `something@something.something`, ≤254 chars; **trimmed and lowercased before insert** |
| 3 | Stellar wallet address (starts with `G`) | Short answer | yes | `wallet` | `^G[A-Z2-7]{55}$` |
| 4 | How would you rate Zentra? | Linear scale 1–5 | no | `rating` | an integer 1–5, or `NULL` when blank |
| 5 | What should we improve? | Paragraph | no | `note` | 1–500 chars, or `NULL` when blank |

Set the form's response destination to a Google Sheet, then **File → Download →
Comma-separated values** to export.

An import needs exactly one transformation: **lowercase the email column.**
Deduplication is not the reason — the unique index is on `lower(email)`, so a
mixed-case import is still caught as a duplicate. The reason is that the column's
documented invariant is that it is stored lowercase, and an import that ignores
that leaves rows `/join` could never have written: an exact-match lookup on
`email` finds the site rows and misses the imported ones, silently. Nothing else
needs changing — the other four columns are stored as the form supplies them.

A form response is self-reported: nobody proves they control the wallet they
typed. An on-site signup is no stronger — only an anchored transaction proves
wallet ownership, which is why `/metrics` counts wallets from the chain rather
than from this table. Keep the two numbers separate when reporting.

---

## Exporting

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://zentra-docs.vercel.app/api/admin/users \
  -o docs/users/onboarding-responses.csv
```

Columns, in order: `name, email, wallet, rating, note, source, created_at`.

Two things the endpoint does that a naive export would not:

- **It is admin-gated.** The registry holds names and email addresses. If
  `ADMIN_TOKEN` is unset the endpoint denies with `503` rather than defaulting
  open — see [`src/lib/api/auth.ts`](../../src/lib/api/auth.ts).
- **It defuses CSV injection.** A field starting `=`, `+`, `-` or `@` is prefixed
  with a single quote, so a value typed into the signup form cannot execute as a
  formula when the sheet is opened in Excel.

To import Google Form responses, insert them with `source = 'form'`. The unique
indexes on `lower(email)` and `wallet` mean a person who signed up both ways is
rejected rather than double-counted — resolve the collision, do not drop the
constraint.

---

## What the data is for

Not vanity metrics. Each field answers a question we could not otherwise answer —
though with zero rows in the table, every one of these is a plan rather than a
finding today:

| Field | Question it answers |
| --- | --- |
| `wallet` | Did this person actually transact? Join against the on-chain action log. |
| `rating` | Is the product improving over time? Compare rating by signup week. |
| `note` | What to build next — this is the input to the iteration table in the root README. |
| `source` | Which channel converts? On-site vs. form vs. backfill. |
| `created_at` | Growth rate, and the denominator for any retention measure. |

## Known gaps

Stated plainly so they are not mistaken for solved problems.

- **The registry has no rows.** Zero people have signed up, so nothing in this
  directory has been validated against real data — not the import path, not the
  `lower(email)` collision behaviour, not any of the analyses below.
- **Retention is unmeasured.** Every figure today is a first-touch count, and the
  count is currently zero. A returning-wallet metric on `/metrics` is the next
  step.
- **Signup does not imply usage.** A row here means somebody registered, not that
  they transacted. Only the on-chain counts prove activity.
- **No deletion path.** Names and emails are stored with no retention policy and
  no delete-my-data endpoint. That must exist before this leaves testnet.
- **The sheet is a snapshot.** It is only as current as the last export; the
  database is the source of truth.
