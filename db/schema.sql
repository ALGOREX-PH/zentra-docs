-- ---------------------------------------------------------------------------
-- Zentra Docs -- feedback schema (PostgreSQL 16 / Neon serverless)
--
-- This file is the SINGLE SOURCE OF TRUTH for the Neon database schema backing
-- the feedback widget. Every table, constraint and index the application relies
-- on is declared here. If it is not in this file, it should not exist in the
-- database; if the app needs something new, add it here first.
--
-- The script is idempotent and safe to re-run: every object is created with
-- IF NOT EXISTS, so applying it against an already-provisioned database is a
-- no-op. It uses plain standard Postgres only -- no extensions required.
--
-- Consumed by:
--   src/lib/db.ts                  -- Neon serverless client (DATABASE_URL)
--   src/app/api/feedback/route.ts  -- GET summary + recent, POST insert
--
-- Apply with:
--   psql "$DATABASE_URL" -f db/schema.sql
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Table: feedback
--
-- One row per submitted rating. Feedback is off-chain by default; a row becomes
-- "on-chain" once the client anchors it to the Soroban contract and reports the
-- resulting Stellar transaction hash back to the API.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feedback (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- 1-5 star rating; validated in the API route and enforced here.
  rating     smallint    NOT NULL
             CONSTRAINT feedback_rating_range
             CHECK (rating BETWEEN 1 AND 5),

  -- Free-text comment, trimmed by the API. Empty comments are not accepted.
  comment    text        NOT NULL
             CONSTRAINT feedback_comment_length
             CHECK (char_length(comment) BETWEEN 1 AND 280),

  -- Optional Stellar account (ed25519 public key, strkey "G..." form).
  wallet     text
             CONSTRAINT feedback_wallet_format
             CHECK (wallet IS NULL OR wallet ~ '^G[A-Z2-7]{55}$'),

  -- Optional Stellar transaction hash, lowercase hex, 32 bytes.
  tx_hash    text
             CONSTRAINT feedback_tx_hash_format
             CHECK (tx_hash IS NULL OR tx_hash ~ '^[0-9a-f]{64}$'),

  -- Invariant: a row may only claim to be on-chain if it carries the anchoring
  -- transaction hash that proves it.
  on_chain   boolean     NOT NULL DEFAULT false
             CONSTRAINT feedback_on_chain_requires_tx_hash
             CHECK (NOT on_chain OR tx_hash IS NOT NULL),

  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Serves: SELECT ... FROM feedback ORDER BY created_at DESC LIMIT 10
CREATE INDEX IF NOT EXISTS feedback_created_at_desc_idx
  ON feedback (created_at DESC);

-- Serves: SELECT sum(case when on_chain then 1 else 0 end) ... FROM feedback
CREATE INDEX IF NOT EXISTS feedback_on_chain_tx_hash_idx
  ON feedback (tx_hash)
  WHERE on_chain;

-- Serves: per-wallet lookups (a contributor's own feedback history)
CREATE INDEX IF NOT EXISTS feedback_wallet_idx
  ON feedback (wallet)
  WHERE wallet IS NOT NULL;

-- Guards: one feedback row per anchoring transaction, so a retried or
-- double-clicked submission cannot be recorded twice. NULL tx_hash rows
-- (plain off-chain feedback) are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS feedback_tx_hash_unique_idx
  ON feedback (tx_hash)
  WHERE tx_hash IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Verification
--
-- Paste these after applying the schema to confirm the result.
--
-- Column list, types, nullability and defaults:
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_name = 'feedback'
--    ORDER BY ordinal_position;
--
-- Every index and its definition (expect 5: primary key + 4 above):
--   SELECT indexname, indexdef
--     FROM pg_indexes
--    WHERE tablename = 'feedback'
--    ORDER BY indexname;
--
-- Named check constraints (expect 5):
--   SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conrelid = 'feedback'::regclass AND contype = 'c'
--    ORDER BY conname;
-- ---------------------------------------------------------------------------
