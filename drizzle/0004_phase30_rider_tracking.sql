-- PHASE 30 — Live rider tracking.
-- Additive columns only. Existing rows keep NULL until a rider reports a fix
-- (assignments) or a delivery order captures dropoff coordinates (orders).

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "dropoff_lat" numeric(9, 6);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "dropoff_lng" numeric(9, 6);

ALTER TABLE "delivery_assignments" ADD COLUMN IF NOT EXISTS "rider_lat" numeric(9, 6);
ALTER TABLE "delivery_assignments" ADD COLUMN IF NOT EXISTS "rider_lng" numeric(9, 6);
ALTER TABLE "delivery_assignments" ADD COLUMN IF NOT EXISTS "rider_heading" numeric(5, 2);
ALTER TABLE "delivery_assignments" ADD COLUMN IF NOT EXISTS "location_updated_at" timestamp with time zone;
CREATE INDEX IF NOT EXISTS "delivery_assignments_location_idx" ON "delivery_assignments" ("location_updated_at");

ALTER TABLE "customer_addresses" ADD COLUMN IF NOT EXISTS "lat" numeric(9, 6);
ALTER TABLE "customer_addresses" ADD COLUMN IF NOT EXISTS "lng" numeric(9, 6);