-- ---------------------------------------------------------------------------
-- 004 -- index cleanup: drop what no query reads, align the on-chain index
--        with the read it serves
--
-- Every index is paid for on every write and in storage, so an index no query
-- reads is a pure cost. Three of those go here, and one partial index is
-- replaced because it filters on the wrong predicate.
--
-- Dropped, because no query the application issues uses them:
--
--   * feedback_wallet_idx          -- built for "per-wallet lookups (a
--     contributor's own feedback history)", an endpoint that was never built.
--     No route reads feedback by wallet.
--   * users_created_at_desc_idx    -- built for "recent signups and
--     growth-over-time". The only reads of `users` are `count(*)` (the onboard
--     counter) and a full-table export ordered ASC (the admin CSV); neither
--     touches this index.
--   * feedback_created_at_desc_idx -- superseded, as the schema's own comment
--     records, by feedback_visible_created_at_desc_idx: every read of the
--     recent list filters `NOT hidden`, so the unfiltered index only ever
--     duplicated the filtered one while also indexing rows it must discard.
--
-- Replaced:
--
--   * feedback_on_chain_tx_hash_idx (WHERE on_chain) -> the live read is the
--     `GET /api/feedback` aggregate, which counts on-chain rows under
--     `WHERE NOT hidden` -- a hidden row must not inflate the on-chain total
--     the dashboard reports. The replacement mirrors that read exactly:
--     `WHERE on_chain AND NOT hidden`. The one-row-per-transaction guarantee
--     is feedback_tx_hash_unique_idx's job and is untouched here.
--
-- Safe to run against live data, and idempotent -- re-running it changes
-- nothing. `DROP INDEX IF EXISTS` on an absent index is a no-op, and the
-- replacement is created `IF NOT EXISTS`.
--
-- Apply with:
--   psql "$DATABASE_URL" -f db/migrations/004_index_cleanup.sql
-- ---------------------------------------------------------------------------

BEGIN;

DROP INDEX IF EXISTS feedback_wallet_idx;
DROP INDEX IF EXISTS users_created_at_desc_idx;
DROP INDEX IF EXISTS feedback_created_at_desc_idx;

DROP INDEX IF EXISTS feedback_on_chain_tx_hash_idx;

-- Serves: the on-chain count inside the GET /api/feedback aggregate,
--   SELECT ..., sum(case when on_chain then 1 else 0 end) ...
--     FROM feedback
--    WHERE NOT hidden
CREATE INDEX IF NOT EXISTS feedback_on_chain_visible_idx
  ON feedback (tx_hash)
  WHERE on_chain AND NOT hidden;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification
--
-- Paste these after applying the migration to confirm the result.
--
-- Every index on both tables. Expect 4 on feedback (primary key,
-- feedback_tx_hash_unique_idx, feedback_visible_created_at_desc_idx,
-- feedback_on_chain_visible_idx) and 3 on users (primary key,
-- users_email_lower_unique_idx, users_wallet_unique_idx):
--
--   SELECT tablename, indexname, indexdef
--     FROM pg_indexes
--    WHERE tablename IN ('feedback','users')
--    ORDER BY tablename, indexname;
--
-- The dropped names should return no rows:
--
--   SELECT indexname
--     FROM pg_indexes
--    WHERE indexname IN ('feedback_wallet_idx',
--                        'users_created_at_desc_idx',
--                        'feedback_created_at_desc_idx',
--                        'feedback_on_chain_tx_hash_idx');
-- ---------------------------------------------------------------------------
