-- Split the restaurant owner key from the POS integration passkey.
-- Mirrors src/db/schema.ts so a plain `npm run db:push` and this file agree.
-- Run via: psql "$DATABASE_URL" -f src/db/migrations/20260930_split_owner_key_and_pos_passkey.sql

-- `owner_key_hash` was doing two jobs at once: it authenticated every
-- /api/partner/* route AND it was the password half of the POS "API key +
-- secret" login. Because both roles read the same column, rotating the passkey
-- silently locked the restaurant owner out of its own console: the new passkey
-- was returned only to the POS, and every partner route then 404'd on a key the
-- restaurant had been holding since onboarding.
--
-- The fix is a second column rather than a behaviour change, so the two
-- credentials can be rotated independently. Existing rows are LEFT NULL on
-- purpose — NULL means "never separated", and the auth path falls back to
-- `owner_key_hash` for them. Backfilling would be actively harmful: it would
-- snapshot the current shared key into both columns, so the next rotation
-- (which writes only this column) would look like a no-op for the passkey and
-- the old key would keep authenticating.
--
-- No backfill, no default: this column is only ever written by onboarding
-- (seeding it equal to the freshly minted owner key, so the restaurant's
-- existing onboarding key still works as its POS passkey until it rotates) and
-- by passkey rotation.
ALTER TABLE "restaurants"
  ADD COLUMN IF NOT EXISTS "integration_passkey_hash" text;
