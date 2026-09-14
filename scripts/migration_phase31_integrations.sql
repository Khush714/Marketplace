-- PHASE 31 — Marketplace integration readiness.
-- Additive only: new tables + nullable columns. The POS's own rows are never
-- rewritten; the primary location / default menu / integration baselines are
-- materialized from the existing `restaurants` records.

-- ---------------------------------------------------------------------------
-- restaurant_locations — physical-address directory (satellite of restaurants)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "restaurant_locations" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "name" varchar(80) NOT NULL DEFAULT 'Primary',
  "address" varchar(240) NOT NULL DEFAULT '',
  "lat" numeric(9, 6),
  "lng" numeric(9, 6),
  "phone" varchar(40) NOT NULL DEFAULT '',
  "is_primary" boolean NOT NULL DEFAULT false,
  "external_id" varchar(80),
  "notes" text NOT NULL DEFAULT '',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "restaurant_locations_restaurant_idx" ON "restaurant_locations" ("restaurant_id");

-- One primary location per restaurant, seeded from the POS record.
INSERT INTO "restaurant_locations" ("restaurant_id", "name", "address", "lat", "lng", "is_primary")
SELECT r."id", 'Primary', r."address", r."lat", r."lng", true
FROM "restaurants" r
WHERE NOT EXISTS (
  SELECT 1 FROM "restaurant_locations" x
  WHERE x."restaurant_id" = r."id" AND x."is_primary" = true
);

-- Enforce a single primary per restaurant (partial unique index).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'restaurant_locations_primary_idx') THEN
    CREATE UNIQUE INDEX "restaurant_locations_primary_idx"
      ON "restaurant_locations" ("restaurant_id")
      WHERE "is_primary" = true;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- menus — integration container, one default menu per restaurant
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "menus" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "name" varchar(120) NOT NULL DEFAULT 'Menu',
  "status" varchar(16) NOT NULL DEFAULT 'active',
  "is_default" boolean NOT NULL DEFAULT true,
  "source" varchar(16) NOT NULL DEFAULT 'manual',
  "external_id" varchar(80),
  "currency" varchar(8) NOT NULL DEFAULT 'INR',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "menus_restaurant_idx" ON "menus" ("restaurant_id");

INSERT INTO "menus" ("restaurant_id", "name", "is_default", "source")
SELECT r."id", 'Menu', true, 'manual'
FROM "restaurants" r
WHERE NOT EXISTS (
  SELECT 1 FROM "menus" m
  WHERE m."restaurant_id" = r."id" AND m."is_default" = true
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'menus_default_idx') THEN
    CREATE UNIQUE INDEX "menus_default_idx"
      ON "menus" ("restaurant_id")
      WHERE "is_default" = true;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- menu_items — nullable ownership pointer + external mapping id
-- ---------------------------------------------------------------------------
ALTER TABLE "menu_items" ADD COLUMN IF NOT EXISTS "menu_id" integer;
ALTER TABLE "menu_items" ADD COLUMN IF NOT EXISTS "external_id" varchar(80);
CREATE INDEX IF NOT EXISTS "menu_items_menu_idx" ON "menu_items" ("menu_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_items_menu_id_fkey') THEN
    ALTER TABLE "menu_items"
      ADD CONSTRAINT "menu_items_menu_id_fkey"
      FOREIGN KEY ("menu_id") REFERENCES "menus"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- Attach existing items to their restaurant's default menu (if any).
UPDATE "menu_items" mi
SET "menu_id" = m."id"
FROM "menus" m
WHERE mi."menu_id" IS NULL
  AND m."restaurant_id" = mi."restaurant_id"
  AND m."is_default" = true;

-- ---------------------------------------------------------------------------
-- restaurant_integrations — the reliable per-restaurant integration record
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "restaurant_integrations" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "provider" varchar(24) NOT NULL DEFAULT 'manual',
  "status" varchar(24) NOT NULL DEFAULT 'disconnected',
  "external_restaurant_id" varchar(80),
  "endpoint_url" text NOT NULL DEFAULT '',
  "api_key_hash" varchar(128) NOT NULL DEFAULT '',
  "api_key_prefix" varchar(12) NOT NULL DEFAULT '',
  "capabilities" text NOT NULL DEFAULT '{}',
  "config" text NOT NULL DEFAULT '{}',
  "last_sync_at" timestamp with time zone,
  "last_success_at" timestamp with time zone,
  "last_error" text NOT NULL DEFAULT '',
  "health_status" varchar(16) NOT NULL DEFAULT 'unknown',
  "version" varchar(24) NOT NULL DEFAULT '',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "restaurant_integrations_status_idx" ON "restaurant_integrations" ("status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'restaurant_integrations_restaurant_key') THEN
    ALTER TABLE "restaurant_integrations" ADD CONSTRAINT "restaurant_integrations_restaurant_key" UNIQUE ("restaurant_id");
  END IF;
END $$;

-- Baseline: every restaurant already counts as a connected business (manual).
INSERT INTO "restaurant_integrations" ("restaurant_id", "provider", "status", "health_status")
SELECT r."id", 'manual', 'disconnected', 'unknown'
FROM "restaurants" r
ON CONFLICT ("restaurant_id") DO NOTHING;

-- ---------------------------------------------------------------------------
-- webhook_events — outbound integration outbox for the later POS connection
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "webhook_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "integration_id" integer REFERENCES "restaurant_integrations"("id") ON DELETE SET NULL,
  "order_id" integer REFERENCES "orders"("id") ON DELETE SET NULL,
  "event_type" varchar(48) NOT NULL,
  "payload" text NOT NULL DEFAULT '{}',
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 5,
  "next_attempt_at" timestamp with time zone,
  "last_http_status" integer,
  "last_error" text NOT NULL DEFAULT '',
  "delivered_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "webhook_events_outbox_idx" ON "webhook_events" ("status", "next_attempt_at");
CREATE INDEX IF NOT EXISTS "webhook_events_restaurant_idx" ON "webhook_events" ("restaurant_id");
CREATE INDEX IF NOT EXISTS "webhook_events_order_idx" ON "webhook_events" ("order_id");
CREATE INDEX IF NOT EXISTS "webhook_events_integration_idx" ON "webhook_events" ("integration_id");