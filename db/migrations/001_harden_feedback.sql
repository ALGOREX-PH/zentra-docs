-- ---------------------------------------------------------------------------
-- 001 -- harden the existing feedback table
--
-- db/schema.sql provisions a NEW database. It cannot fix an EXISTING one:
-- `CREATE TABLE IF NOT EXISTS` is a silent no-op against a table that is
-- already there, so a database created before the constraints were written
-- keeps none of them. This migration retrofits them.
--
-- Safe to run against live data, and idempotent -- re-running it changes
-- nothing. Every constraint is added `NOT VALID`, which means:
--   * it is enforced on every INSERT and UPDATE from the moment it is added
--   * existing rows are NOT scanned, so the statement takes no long lock
--   * pre-existing bad rows survive until you choose to deal with them
--
-- Apply with:
--   psql "$DATABASE_URL" -f db/migrations/001_harden_feedback.sql
--
-- Then see the "Validating" section at the end to promote the constraints once
-- the historical rows are known to be clean.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- Normalise data the new rules care about, before the rules are added.
--
-- Transaction hashes are stored lowercase (the format check and the unique
-- index both assume it). This is a pure normalisation -- no row is discarded.
-- ---------------------------------------------------------------------------
UPDATE feedback
   SET tx_hash = lower(tx_hash)
 WHERE tx_hash IS NOT NULL
   AND tx_hash <> lower(tx_hash);

-- A row claiming to be on-chain without the hash that proves it is unprovable,
-- so demote the claim rather than deleting the person's feedback.
UPDATE feedback
   SET on_chain = false
 WHERE on_chain
   AND tx_hash IS NULL;

-- ---------------------------------------------------------------------------
-- Constraints. Postgres has no ADD CONSTRAINT IF NOT EXISTS, so each one is
-- guarded by a lookup against pg_constraint to keep the script re-runnable.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feedback_rating_range') THEN
    ALTER TABLE feedback
      ADD CONSTRAINT feedback_rating_range
      CHECK (rating BETWEEN 1 AND 5) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feedback_comment_length') THEN
    ALTER TABLE feedback
      ADD CONSTRAINT feedback_comment_length
      CHECK (char_length(comment) BETWEEN 1 AND 280) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feedback_wallet_format') THEN
    ALTER TABLE feedback
      ADD CONSTRAINT feedback_wallet_format
      CHECK (wallet IS NULL OR wallet ~ '^G[A-Z2-7]{55}$') NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feedback_tx_hash_format') THEN
    ALTER TABLE feedback
      ADD CONSTRAINT feedback_tx_hash_format
      CHECK (tx_hash IS NULL OR tx_hash ~ '^[0-9a-f]{64}$') NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feedback_on_chain_requires_tx_hash') THEN
    ALTER TABLE feedback
      ADD CONSTRAINT feedback_on_chain_requires_tx_hash
      CHECK (NOT on_chain OR tx_hash IS NOT NULL) NOT VALID;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Indexes. These are already IF NOT EXISTS, so they need no guard.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS feedback_created_at_desc_idx
  ON feedback (created_at DESC);

CREATE INDEX IF NOT EXISTS feedback_on_chain_tx_hash_idx
  ON feedback (tx_hash)
  WHERE on_chain;

CREATE INDEX IF NOT EXISTS feedback_wallet_idx
  ON feedback (wallet)
  WHERE wallet IS NOT NULL;

COMMIT;

-- ---------------------------------------------------------------------------
-- The unique index is deliberately NOT in the transaction above.
--
-- It is the one statement that can fail on existing data: if two rows already
-- share a tx_hash, creating it aborts. Run the duplicate check first, resolve
-- anything it returns, then create the index.
--
-- 1. Find duplicates (expect zero rows):
--      SELECT tx_hash, count(*)
--        FROM feedback
--       WHERE tx_hash IS NOT NULL
--       GROUP BY tx_hash
--      HAVING count(*) > 1;
--
-- 2. If that returned nothing, create it:
--      CREATE UNIQUE INDEX IF NOT EXISTS feedback_tx_hash_unique_idx
--        ON feedback (tx_hash)
--        WHERE tx_hash IS NOT NULL;
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Validating
--
-- The constraints above guard every new write but are marked NOT VALID, so
-- Postgres has not confirmed the historical rows satisfy them. Check first:
--
--   SELECT count(*) FROM feedback WHERE rating NOT BETWEEN 1 AND 5;
--   SELECT count(*) FROM feedback WHERE char_length(comment) NOT BETWEEN 1 AND 280;
--   SELECT count(*) FROM feedback WHERE wallet IS NOT NULL AND wallet !~ '^G[A-Z2-7]{55}$';
--   SELECT count(*) FROM feedback WHERE tx_hash IS NOT NULL AND tx_hash !~ '^[0-9a-f]{64}$';
--
-- Once every count is zero, promote them (each takes a brief scan):
--
--   ALTER TABLE feedback VALIDATE CONSTRAINT feedback_rating_range;
--   ALTER TABLE feedback VALIDATE CONSTRAINT feedback_comment_length;
--   ALTER TABLE feedback VALIDATE CONSTRAINT feedback_wallet_format;
--   ALTER TABLE feedback VALIDATE CONSTRAINT feedback_tx_hash_format;
--   ALTER TABLE feedback VALIDATE CONSTRAINT feedback_on_chain_requires_tx_hash;
--
-- Confirm the result (convalidated should be true for all five):
--
--   SELECT conname, convalidated
--     FROM pg_constraint
--    WHERE conrelid = 'feedback'::regclass AND contype = 'c'
--    ORDER BY conname;
-- ---------------------------------------------------------------------------
