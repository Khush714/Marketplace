-- Phase 4 — Order Ingestion & POS Lifecycle Integration (idempotent).
-- Mirrors src/db/schema.ts so a plain `npm run db:push` and this file agree.
-- Run via: psql "$DATABASE_URL" -f src/db/migrations/20260922_marketplace_pos_order_bridge.sql

-- Orders gain the POS delivery + lifecycle columns (all additive / nullable-safe
-- for legacy rows; the NOT NULL defaults backfill existing orders as
-- PENDING / PLACED, which stay on the demo elapsed-time tracking path).
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "external_order_id" text,
  ADD COLUMN IF NOT EXISTS "pos_order_id" integer,
  ADD COLUMN IF NOT EXISTS "pos_delivery_status" text DEFAULT 'PENDING' NOT NULL,
  ADD COLUMN IF NOT EXISTS "integration_status" text DEFAULT 'PLACED' NOT NULL,
  ADD COLUMN IF NOT EXISTS "status_updated_at" timestamptz DEFAULT now() NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "orders_external_order_id_unique" ON "orders" ("external_order_id");

-- Deliveries journal — durable at-least-once order -> POS bridge runtime.
CREATE TABLE IF NOT EXISTS "marketplace_pos_order_deliveries" (
  "id" serial PRIMARY KEY NOT NULL,
  "marketplace_order_id" integer NOT NULL,
  "external_order_id" text NOT NULL,
  "restaurant_id" integer NOT NULL,
  "pos_order_id" integer,
  "status" text DEFAULT 'PENDING' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "next_attempt_at" timestamptz,
  "delivered_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "pos_order_deliveries_marketplace_order_id_unique"
  ON "marketplace_pos_order_deliveries" ("marketplace_order_id");
CREATE UNIQUE INDEX IF NOT EXISTS "pos_order_deliveries_external_order_id_unique"
  ON "marketplace_pos_order_deliveries" ("external_order_id");
CREATE INDEX IF NOT EXISTS "pos_deliveries_status_attempt_idx"
  ON "marketplace_pos_order_deliveries" ("status", "next_attempt_at");

-- Renamed FK constraints below use stable short names: Postgres truncates
-- auto-generated names past 63 chars, which makes `db:push` drop/re-add them
-- forever. Names here match drizzle's schema.ts `foreignKey({ name })` hooks.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_deliveries_marketplace_order_fk') THEN
    ALTER TABLE "marketplace_pos_order_deliveries"
      ADD CONSTRAINT "pos_deliveries_marketplace_order_fk"
      FOREIGN KEY ("marketplace_order_id") REFERENCES "orders"("id") ON DELETE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_deliveries_restaurant_fk') THEN
    ALTER TABLE "marketplace_pos_order_deliveries"
      ADD CONSTRAINT "pos_deliveries_restaurant_fk"
      FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE cascade;
  END IF;
END $$;

-- Order-status webhook dedupe ledger (POS outbox replays coalesce onto event_id).
CREATE TABLE IF NOT EXISTS "marketplace_order_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL,
  "event_id" text NOT NULL,
  "external_order_id" text NOT NULL,
  "pos_order_id" integer,
  "status" text NOT NULL,
  "received_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_order_events_event_id_unique"
  ON "marketplace_order_events" ("event_id");
CREATE INDEX IF NOT EXISTS "marketplace_order_events_restaurant_idx"
  ON "marketplace_order_events" ("restaurant_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_events_restaurant_fk') THEN
    ALTER TABLE "marketplace_order_events"
      ADD CONSTRAINT "order_events_restaurant_fk"
      FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_item_mod_groups_mod_group_fk') THEN
    ALTER TABLE "menu_item_modifier_groups"
      ADD CONSTRAINT "menu_item_mod_groups_mod_group_fk"
      FOREIGN KEY ("modifier_group_id") REFERENCES "modifier_groups"("id") ON DELETE cascade;
  END IF;
END $$;