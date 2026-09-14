-- PHASE 32 — Restaurant identity.
-- Every restaurant receives a permanent marketplace ID plus identity fields
-- (phone, opening hours). Additive; existing rows are backfilled, never
-- rewritten.

ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "marketplace_id" varchar(24);
ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "phone" varchar(40) NOT NULL DEFAULT '';
ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "opening_hours" text NOT NULL DEFAULT '{}';

-- Backfill: permanent marketplace id derived from the row's id (guaranteed
-- unique, deterministic — e.g. rst_00000001 style). App-level inserts now
-- generate their own rst_<base36> id via src/lib/format.ts.
UPDATE "restaurants"
SET "marketplace_id" = 'rst_' || lpad(to_hex("id"), 8, '0')
WHERE "marketplace_id" IS NULL OR "marketplace_id" = '';

ALTER TABLE "restaurants" ALTER COLUMN "marketplace_id" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurants_marketplace_id_key') THEN
    ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_marketplace_id_key" UNIQUE ("marketplace_id");
  END IF;
END $$;