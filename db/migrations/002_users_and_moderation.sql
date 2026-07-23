-- ---------------------------------------------------------------------------
-- 002 -- users registry + feedback moderation
--
-- Two additions, driven by two things that happened after 001 shipped.
--
-- 1. The growth programme needs somewhere to put the people who sign up. The
--    `users` table is that registry: one row per person, whether they signed
--    up on the site or arrived in a batch imported from the Google Form.
--
-- 2. An abusive submission reached the public feed. Deleting it would erase
--    the record, so `feedback` gains a `hidden` flag instead: automated
--    moderation sets it, the row is retained, and public reads skip it.
--
-- Safe to run against live data, and idempotent -- re-running it changes
-- nothing. Unlike 001, nothing here is added `NOT VALID`: the new column has
-- a non-null default rather than a constraint, and `users` is a brand new
-- table with no legacy rows for a constraint to trip over.
--
-- Apply with:
--   psql "$DATABASE_URL" -f db/migrations/002_users_and_moderation.sql
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- Moderation flag on feedback.
--
-- Cheap even on a populated table: the default is NOT NULL, so Postgres 11+
-- records it in the catalogue and hands it to existing rows on read instead of
-- rewriting the heap. No long lock, no downtime.
-- ---------------------------------------------------------------------------
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;

-- Serves: SELECT ... FROM feedback WHERE NOT hidden ORDER BY created_at DESC
-- Supersedes feedback_created_at_desc_idx for that query -- the unfiltered
-- index still has to read and discard hidden rows; this one never sees them.
CREATE INDEX IF NOT EXISTS feedback_visible_created_at_desc_idx
  ON feedback (created_at DESC)
  WHERE NOT hidden;

-- ---------------------------------------------------------------------------
-- Table: users
--
-- The onboarding registry for the growth programme. One row per person who
-- signs up. Every constraint is declared inline: a new table has no legacy
-- rows to accommodate, so `NOT VALID` is unnecessary here -- each rule is
-- valid from the moment the table exists.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Display name, trimmed by the API. Empty names are not accepted.
  name       text        NOT NULL
             CONSTRAINT users_name_length
             CHECK (char_length(name) BETWEEN 1 AND 80),

  -- Contact address. Deliberately permissive -- this rejects obvious junk,
  -- it does not attempt to decide what a valid mailbox is. Stored lowercase:
  -- the API lowercases before insert, and the unique index below assumes it.
  email      text        NOT NULL
             CONSTRAINT users_email_format
             CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),

  -- Stellar account (ed25519 public key, strkey "G..." form). Required here,
  -- unlike on feedback: the programme is keyed to a wallet.
  wallet     text        NOT NULL
             CONSTRAINT users_wallet_format
             CHECK (wallet ~ '^G[A-Z2-7]{55}$'),

  -- Optional 1-5 star rating given at signup.
  rating     smallint
             CONSTRAINT users_rating_range
             CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),

  -- Optional free-text note left at signup.
  note       text
             CONSTRAINT users_note_length
             CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 500),

  -- Where the signup came from: 'site' is an on-site signup, 'form' a Google
  -- Form submission, 'import' a backfilled batch.
  source     text        NOT NULL DEFAULT 'site'
             CONSTRAINT users_source_allowed
             CHECK (source IN ('site','form','import')),

  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Indexes on users.
--
-- The two unique indexes can fail on pre-existing duplicates, which is why 001
-- kept its unique index outside the transaction behind a duplicate check.
-- That cannot happen here: `users` is created by this migration, so it is
-- empty when the indexes are built and there is nothing to check.
-- ---------------------------------------------------------------------------

-- Guards: one signup per person. Also serves the login/lookup-by-email path,
-- SELECT ... FROM users WHERE lower(email) = lower($1).
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique_idx
  ON users (lower(email));

-- Guards: one signup per wallet, so the same account cannot enrol twice.
CREATE UNIQUE INDEX IF NOT EXISTS users_wallet_unique_idx
  ON users (wallet);

-- Serves: recent signups and growth-over-time,
-- SELECT ... FROM users ORDER BY created_at DESC LIMIT 10
CREATE INDEX IF NOT EXISTS users_created_at_desc_idx
  ON users (created_at DESC);

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification
--
-- Paste these after applying the migration to confirm the result.
--
-- feedback columns -- `hidden` should appear last, boolean, NO, false:
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_name = 'feedback'
--    ORDER BY ordinal_position;
--
-- users columns (expect 8):
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_name = 'users'
--    ORDER BY ordinal_position;
--
-- Every index on both tables (expect 6 on feedback, 4 on users):
--   SELECT tablename, indexname, indexdef
--     FROM pg_indexes
--    WHERE tablename IN ('feedback','users')
--    ORDER BY tablename, indexname;
--
-- Hidden rows, i.e. how much moderation has taken out of the public feed:
--   SELECT count(*) FILTER (WHERE hidden) AS hidden,
--          count(*)                       AS total
--     FROM feedback;
-- ---------------------------------------------------------------------------
