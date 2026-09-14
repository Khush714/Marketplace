-- PHASE 29 — Delivery partners + per-order assignments.
CREATE TABLE IF NOT EXISTS "delivery_partners" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" varchar(160) NOT NULL,
  "phone" varchar(40) NOT NULL,
  "vehicle_type" varchar(24) DEFAULT 'bike' NOT NULL,
  "status" varchar(24) DEFAULT 'available' NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "total_deliveries" integer DEFAULT 0 NOT NULL,
  "rating" numeric(3, 2) DEFAULT '5.00' NOT NULL,
  "notes" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "delivery_partners_phone_key" ON "delivery_partners" ("phone");
CREATE INDEX IF NOT EXISTS "delivery_partners_status_idx" ON "delivery_partners" ("status");

CREATE TABLE IF NOT EXISTS "delivery_assignments" (
  "id" serial PRIMARY KEY NOT NULL,
  "order_id" integer NOT NULL,
  "partner_id" integer,
  "status" varchar(24) DEFAULT 'assigned' NOT NULL,
  "token" varchar(40) NOT NULL,
  "assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
  "accepted_at" timestamp with time zone,
  "picked_up_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "note" text DEFAULT '' NOT NULL,
  "rider_lat" numeric(9, 6),
  "rider_lng" numeric(9, 6),
  "rider_heading" numeric(5, 2),
  "location_updated_at" timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "delivery_assignments_order_key" ON "delivery_assignments" ("order_id");
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_assignments_token_key" ON "delivery_assignments" ("token");
CREATE INDEX IF NOT EXISTS "delivery_assignments_partner_idx" ON "delivery_assignments" ("partner_id");
CREATE INDEX IF NOT EXISTS "delivery_assignments_location_idx" ON "delivery_assignments" ("location_updated_at");

ALTER TABLE "delivery_assignments" ADD CONSTRAINT "delivery_assignments_order_id_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE cascade;
ALTER TABLE "delivery_assignments" ADD CONSTRAINT "delivery_assignments_partner_id_delivery_partners_id_fk"
  FOREIGN KEY ("partner_id") REFERENCES "delivery_partners"("id") ON DELETE set null;

-- Dropoff coordinates live on `orders` (rider view + live tracking need them).
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "dropoff_lat" numeric(9, 6);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "dropoff_lng" numeric(9, 6);