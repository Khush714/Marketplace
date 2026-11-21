-- Phase 6: give orders a bearer tracking token.
-- Mirrors src/db/schema.ts so `npm run db:push` and this file agree.
-- Run via: node scripts/db-migrate.mjs

-- Customer tracking is authenticated by a per-order HMAC token minted at
-- checkout and stored in the placing browser's localStorage. That makes the
-- order unreadable from any other device. Phase 6 mints every new order a
-- 128-bit random tracking token whose hash lives here, and the customer URL
-- becomes /order/<tracking-token>. The raw token is returned exactly once, at
-- checkout; the database only ever holds something a leak cannot be used
-- against.
--
-- Legacy rows are backfilled with a random sha256 value so the unique index can
-- be drawn without a single NULL. The value is derived from gen_random_uuid()
-- (core PG13+) and clock_timestamp(), needing no pgcrypto extension. It is 64
-- hex chars — the same shape as a real hash — so the column reads uniformly.
-- Customers never receive these backfilled tokens; they keep using the code
-- + HMAC path until their browsers re-order.

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "tracking_token_hash" text;

UPDATE "orders"
  SET "tracking_token_hash" = encode(
    sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')),
    'hex'
  )
  WHERE "tracking_token_hash" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "orders_tracking_token_hash_unique"
  ON "orders" ("tracking_token_hash");