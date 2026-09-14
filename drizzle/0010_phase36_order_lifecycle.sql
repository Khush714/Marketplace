-- PHASE 9 — canonical order lifecycle architecture (drizzle mirror).
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "rejected_at" timestamp with time zone;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "picked_up_at" timestamp with time zone;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "delivered_at" timestamp with time zone;