-- Let an operator withdraw an unused connection code.
-- Mirrors src/db/schema.ts so a plain `npm run db:push` and this file agree.
-- Run via: node scripts/db-migrate.mjs

-- A minted CNX-… code is a single-use capability to create a LIVE listing, and
-- ops could already mint them but had no way to take one back. That left a code
-- that leaked in a screenshot, went to the wrong address, or was issued twice for
-- the same restaurant redeemable until it expired — or forever, since `days` is
-- optional and the default mints with no expiry at all.
--
-- The status column is already text holding 'unused' | 'used'; this adds the
-- third state rather than a boolean flag, because "used" and "revoked" are not the
-- same claim. "used" means a listing exists downstream and the row is pinned by
-- `connections.code_id`; "revoked" means it was withdrawn before anyone spent it
-- and there is nothing downstream. Revocation is written only for codes still
-- 'unused' (see revokeConnectionCode), so a spent code can never be returned to
-- circulation and redeemed a second time into a duplicate live listing.
--
-- `revoked_at` exists so the console can show when a code was pulled rather than
-- only that it is dead, which is the difference between "I withdrew it" and "I
-- can't tell what happened to it". No index: the column is only ever read on rows
-- an operator already selected by id or code, both of which are already indexed.
ALTER TABLE "connection_codes"
  ADD COLUMN IF NOT EXISTS "revoked_at" timestamptz;

-- Backstop for rows written before this migration: anything already past 'unused'
-- that is not 'used' is treated as withdrawn. Without this, an unrecognised
-- legacy status would pass the 'unused' predicate in redeemConnectionCode and
-- stay redeemable, which is the failure this whole change exists to close.
UPDATE "connection_codes"
   SET "status" = 'revoked', "revoked_at" = now()
 WHERE "status" NOT IN ('unused', 'used', 'revoked');