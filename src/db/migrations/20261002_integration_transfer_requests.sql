-- Ownership transfer for a POS identity (`marketplace_id`) that is already held
-- by another listing. Mirrors src/db/schema.ts so `npm run db:push` and this
-- file agree.
-- Run via: psql "$DATABASE_URL" -f src/db/migrations/20261002_integration_transfer_requests.sql

-- Why this table exists
-- ---------------------
-- `restaurants.marketplace_id` is UNIQUE, and a claim checks it before any
-- write (see syncMarketplaceId in src/db/queries.ts). A POS that reconnects
-- under a new listing while its id is still held elsewhere therefore failed the
-- claim with MARKETPLACE_ID_TAKEN — a correct refusal with no route forward, and
-- it arrived AFTER the POS had already redeemed its single-use connection code.
-- The operator was left holding a burned code and a dead end: the only recovery
-- was an engineer editing `restaurants.marketplace_id` by hand.
--
-- This table makes that refusal recoverable in the product: the losing listing
-- records what it wants and which listing it would take the id from, and ops
-- approves or denies. Nothing moves without a decision row.
--
-- One pending request per (marketplace_id, requesting listing). The partial
-- UNIQUE index is what stops a retry loop from piling up duplicate asks for the
-- same move; decided rows are kept for audit and are exempt from it.
CREATE TABLE IF NOT EXISTS "integration_transfer_requests" (
  "id" serial PRIMARY KEY,
  -- The listing that asked to receive the identity.
  "requested_by_restaurant_id" integer NOT NULL
    REFERENCES "restaurants"("id") ON DELETE CASCADE,
  -- The listing that holds the identity today. It is the one that gets audited
  -- and disconnected on approval, so it is recorded rather than re-derived: by
  -- the time ops looks, the holder may have changed.
  "previous_restaurant_id" integer NOT NULL
    REFERENCES "restaurants"("id") ON DELETE CASCADE,
  -- The contested `rst_…` value. Copied so a request stays readable (and
  -- approvable) even after one side of the pair is edited.
  "marketplace_id" text NOT NULL,
  -- Informational: the POS-side id from the claim that raised the conflict.
  "pos_restaurant_id" text,
  "status" text NOT NULL DEFAULT 'pending',
  "note" text,
  -- Free text from the requesting operator, and the ops reason when denied.
  "requested_by_ip" text,
  "decided_by" text,
  "requested_at" timestamptz NOT NULL DEFAULT now(),
  "decided_at" timestamptz
);

DO $$ BEGIN
  -- Deliberately partial: only 'pending' rows are constrained, so the full
  -- decision history is retained while duplicate open asks stay impossible.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'integration_transfer_requests_pending_uniq'
  ) THEN
    CREATE UNIQUE INDEX "integration_transfer_requests_pending_uniq"
      ON "integration_transfer_requests" ("marketplace_id", "requested_by_restaurant_id")
      WHERE "status" = 'pending';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'integration_transfer_requests_status_idx'
  ) THEN
    CREATE INDEX "integration_transfer_requests_status_idx"
      ON "integration_transfer_requests" ("status", "requested_at" DESC);
  END IF;
END $$;
