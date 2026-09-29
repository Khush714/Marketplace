-- Onboarding ↔ marketplace integration: honest listing facts + a recorded POS
-- connection. Mirrors src/db/schema.ts so a plain `npm run db:push` and this
-- file agree.
-- Run via: psql "$DATABASE_URL" -f src/db/migrations/20260929_onboarding_marketplace_bridge.sql

-- 1. Orders remember whether they were admitted through a live POS.
--
-- `external_order_id` could not answer this: createOrder stamps it on every
-- order unconditionally, so `externalOrderId != null` was true for all of them
-- and the elapsed-time demo tracking timeline became unreachable. Seeded/demo
-- orders (which have no integration record at all) are the rows that needed
-- it, and they default to FALSE.
--
-- Stamped at creation rather than re-derived so a POS that is disabled while an
-- order is in flight cannot retroactively rewrite which lifecycle it belongs to.
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "pos_connected" boolean DEFAULT false NOT NULL;

-- 2. distance_km becomes nullable: "we have not measured this" is now
-- expressible, where before every listing inherited a demo default of 2 and
-- printed an invented "2.0 km".
--
-- NULL is the correct value for a listing that has never been measured, so
-- existing rows are left alone rather than backfilled — the seeded demo rows
-- all set a real distance and are unaffected. Customer surfaces render
-- "Nearby" while null, and `sort=near` puts NULLS LAST explicitly.
--
-- The NOT NULL default is dropped so new rows cannot silently re-acquire the
-- fabricated value.
ALTER TABLE "restaurants"
  ALTER COLUMN "distance_km" DROP NOT NULL,
  ALTER COLUMN "distance_km" DROP DEFAULT;
