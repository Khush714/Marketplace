-- Phase 10 (10.3) — index review, additions only.
--
-- The eight candidates were cross-checked against src/db/schema.ts AND this
-- migrations directory. Four already have an index and are deliberately NOT
-- re-created here — a duplicate index is pure write cost:
--
--   orders.code                     -> column UNIQUE (exists)
--   connection_codes.code           -> column UNIQUE (exists)
--   integration_sessions.token_hash -> column UNIQUE (exists)
--   integration_sessions.restaurant_id -> integration_sessions_restaurant_id_idx (exists)
--
-- Added below (names match src/db/schema.ts so db:push stays in agreement):

-- Restaurant-scoped orders: FK lookups plus listIntegrationOrders'
-- `WHERE restaurant_id = ? ORDER BY created_at DESC`. The composite's leading
-- column serves the plain equality lookups too, so a separate
-- (restaurant_id) index would only duplicate its prefix.
CREATE INDEX IF NOT EXISTS "orders_restaurant_created_idx"
  ON "orders" ("restaurant_id", "created_at");

-- Cross-restaurant recency/time ranges: created_at is not the composite's
-- leading column, so this one is not derivable from it.
CREATE INDEX IF NOT EXISTS "orders_created_at_idx" ON "orders" ("created_at");

-- Status partitions connection codes (unused vs terminal) for counts, sweeps
-- and filtered listings. Redemption/revocation predicates lead with the unique
-- `code` column and never needed this; a status-scanned query would
-- seq-scan as codes accumulate.
CREATE INDEX IF NOT EXISTS "connection_codes_status_idx" ON "connection_codes" ("status");

-- Owner-key exchange (restaurantIdForOwnerKey) is
-- `WHERE owner_key_hash = ?` on an authentication path — previously a
-- sequential scan of restaurants on every owner-key login.
CREATE INDEX IF NOT EXISTS "restaurants_owner_key_hash_idx"
  ON "restaurants" ("owner_key_hash");

-- Plain CREATE INDEX, not CONCURRENTLY: the migration runner wraps each file
-- in one transaction, and CONCURRENTLY cannot run inside one. The lock is
-- proportional to table size — fine at template scale. If applying to a large
-- existing `orders` table, run this statement by hand with CONCURRENTLY in a
-- maintenance window instead of through the runner.
