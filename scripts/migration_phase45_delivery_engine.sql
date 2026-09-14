-- PHASE 45 — Delivery engine.
--
-- Adds the decoupled delivery track (delivery_orders), a per-restaurant rider
-- directory (delivery_riders), a rider position-history ledger (rider_locations)
-- and a delivery-event audit trail (delivery_events). `delivery_assignments`
-- gains delivery_order_id / rider_id / provider so the working platform-rider
-- flow links into the new track without a rebuild.
--
-- `orders.status` stays the FOOD lifecycle; `delivery_orders.delivery_status`
-- is the authoritative DELIVERY lifecycle (pending → assigned → accepted →
-- at_restaurant → picked_up → out_for_delivery → arriving → delivered,
-- plus failed / cancelled) — see src/lib/delivery-status.ts.

CREATE TABLE IF NOT EXISTS "delivery_orders" (
  "id" serial PRIMARY KEY NOT NULL,
  "order_id" integer NOT NULL,
  "restaurant_id" integer NOT NULL,
  "delivery_status" varchar(24) DEFAULT 'pending' NOT NULL,
  "delivery_mode" varchar(24) DEFAULT 'platform' NOT NULL,
  "delivery_fee" numeric(10, 2) DEFAULT '0' NOT NULL,
  "pickup_lat" numeric(9, 6),
  "pickup_lng" numeric(9, 6),
  "dropoff_lat" numeric(9, 6),
  "dropoff_lng" numeric(9, 6),
  "estimated_pickup_at" timestamp with time zone,
  "estimated_delivery_at" timestamp with time zone,
  "provider" varchar(40) DEFAULT '' NOT NULL,
  "provider_delivery_id" varchar(80) DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "delivery_orders_order_key" ON "delivery_orders" ("order_id");
CREATE INDEX IF NOT EXISTS "delivery_orders_restaurant_idx" ON "delivery_orders" ("restaurant_id");
CREATE INDEX IF NOT EXISTS "delivery_orders_status_idx" ON "delivery_orders" ("delivery_status");

ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_order_id_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE cascade;
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_restaurant_id_restaurants_id_fk"
  FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE cascade;

CREATE TABLE IF NOT EXISTS "delivery_riders" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL,
  "name" varchar(160) NOT NULL,
  "phone" varchar(40) NOT NULL,
  "vehicle_type" varchar(24) DEFAULT 'bike' NOT NULL,
  "status" varchar(24) DEFAULT 'available' NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "delivery_riders_restaurant_idx" ON "delivery_riders" ("restaurant_id");
CREATE INDEX IF NOT EXISTS "delivery_riders_status_idx" ON "delivery_riders" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_riders_restaurant_phone_key" ON "delivery_riders" ("restaurant_id", "phone");

ALTER TABLE "delivery_riders" ADD CONSTRAINT "delivery_riders_restaurant_id_restaurants_id_fk"
  FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE cascade;

-- Evolve delivery_assignments (additive; existing rows keep NULLs / default).
ALTER TABLE "delivery_assignments" ADD COLUMN IF NOT EXISTS "delivery_order_id" integer;
ALTER TABLE "delivery_assignments" ADD COLUMN IF NOT EXISTS "rider_id" integer;
ALTER TABLE "delivery_assignments" ADD COLUMN IF NOT EXISTS "provider" varchar(24) DEFAULT 'platform' NOT NULL;

ALTER TABLE "delivery_assignments" ADD CONSTRAINT "delivery_assignments_delivery_order_id_delivery_orders_id_fk"
  FOREIGN KEY ("delivery_order_id") REFERENCES "delivery_orders"("id") ON DELETE set null;
ALTER TABLE "delivery_assignments" ADD CONSTRAINT "delivery_assignments_rider_id_delivery_riders_id_fk"
  FOREIGN KEY ("rider_id") REFERENCES "delivery_riders"("id") ON DELETE set null;

CREATE INDEX IF NOT EXISTS "delivery_assignments_rider_idx" ON "delivery_assignments" ("rider_id");
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_assignments_delivery_order_key"
  ON "delivery_assignments" ("delivery_order_id") WHERE "delivery_order_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "rider_locations" (
  "id" serial PRIMARY KEY NOT NULL,
  "delivery_order_id" integer,
  "rider_id" integer,
  "partner_id" integer,
  "latitude" numeric(9, 6) NOT NULL,
  "longitude" numeric(9, 6) NOT NULL,
  "heading" numeric(5, 2),
  "speed" numeric(6, 2),
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "rider_locations_delivery_order_idx" ON "rider_locations" ("delivery_order_id", "recorded_at");
CREATE INDEX IF NOT EXISTS "rider_locations_rider_idx" ON "rider_locations" ("rider_id");

ALTER TABLE "rider_locations" ADD CONSTRAINT "rider_locations_delivery_order_id_delivery_orders_id_fk"
  FOREIGN KEY ("delivery_order_id") REFERENCES "delivery_orders"("id") ON DELETE cascade;
ALTER TABLE "rider_locations" ADD CONSTRAINT "rider_locations_rider_id_delivery_riders_id_fk"
  FOREIGN KEY ("rider_id") REFERENCES "delivery_riders"("id") ON DELETE set null;
ALTER TABLE "rider_locations" ADD CONSTRAINT "rider_locations_partner_id_delivery_partners_id_fk"
  FOREIGN KEY ("partner_id") REFERENCES "delivery_partners"("id") ON DELETE set null;

CREATE TABLE IF NOT EXISTS "delivery_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "delivery_order_id" integer,
  "event_type" varchar(40) NOT NULL,
  "actor" varchar(24) DEFAULT 'system' NOT NULL,
  "metadata" text DEFAULT '{}' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "delivery_events_delivery_order_idx" ON "delivery_events" ("delivery_order_id", "created_at");
CREATE INDEX IF NOT EXISTS "delivery_events_type_idx" ON "delivery_events" ("event_type");

ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_delivery_order_id_delivery_orders_id_fk"
  FOREIGN KEY ("delivery_order_id") REFERENCES "delivery_orders"("id") ON DELETE cascade;