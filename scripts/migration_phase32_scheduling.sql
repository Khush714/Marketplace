-- PHASE 32 — Scheduled orders.
-- Additive only: one nullable delivery-window column on orders. A scheduled
-- order carries the future window chosen at checkout; NULL means ASAP. The
-- rider machine refuses to mark a scheduled delivery complete before the
-- window, and every surface (tracker, notifications, dispatch) shows it.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "scheduled_for" timestamp with time zone;
CREATE INDEX IF NOT EXISTS "orders_scheduled_idx" ON "orders" ("scheduled_for");