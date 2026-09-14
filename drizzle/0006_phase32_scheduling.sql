-- PHASE 32 — Scheduled orders.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "scheduled_for" timestamp with time zone;
CREATE INDEX IF NOT EXISTS "orders_scheduled_idx" ON "orders" ("scheduled_for");