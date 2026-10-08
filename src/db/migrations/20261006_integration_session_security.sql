-- Phase 5.2: give integration sessions an idle clock, metadata, and a targeted
-- sign-out. Mirrors src/db/schema.ts so `npm run db:push` and this file agree.
-- Run via: node scripts/db-migrate.mjs

-- Before this, an integration session had exactly one clock: `expires_at`, an
-- absolute hour-long ceiling minted at login. That bound is real but it is the
-- wrong one for the token-theft case. A stolen session dies at the hour mark no
-- matter what, but "no matter what" includes the thief's transport — whose
-- polling keeps the session alive for the full hour and looks exactly like a
-- busy POS. An idle window closes the gap: any authenticated request extends
-- the window, and the first long silence after the token leaves the restaurant
-- lets the session die on its own.
--
-- The rotation and logout surfaces are covered by the queries, not this file;
-- what the database needs is the idle column, metadata for the audit trail, and
-- the working scans (revoke-all per restaurant, the future idle sweep). All of
-- it additive, all of it re-runnable.

-- Sliding inactivity cutoff. Backfilled from the earliest moment we can
-- plausibly call "last used" (or creation for rows minted before this column
-- existed), then made NOT NULL so every future insert carries it.
ALTER TABLE "integration_sessions"
  ADD COLUMN IF NOT EXISTS "idle_expires_at" timestamptz;

UPDATE "integration_sessions"
  SET "idle_expires_at" =
    COALESCE("last_used_at", "created_at") + INTERVAL '30 minutes'
  WHERE "idle_expires_at" IS NULL;

ALTER TABLE "integration_sessions"
  ALTER COLUMN "idle_expires_at" SET NOT NULL;

-- Mint-time metadata, for the audit trail and for support telling a legitimate
-- terminal from a replayed header.
ALTER TABLE "integration_sessions"
  ADD COLUMN IF NOT EXISTS "ip_address" text,
  ADD COLUMN IF NOT EXISTS "user_agent" text;

-- Revoke-all (and the rotation that revokes all sessions afterwards) walks one
-- restaurant's rows; without this it is a scan of the table. The idle index is
-- for the future sweep that reaps sessions whose window lapsed silently.
CREATE INDEX IF NOT EXISTS "integration_sessions_restaurant_id_idx"
  ON "integration_sessions" ("restaurant_id");

CREATE INDEX IF NOT EXISTS "integration_sessions_idle_expires_at_idx"
  ON "integration_sessions" ("idle_expires_at");