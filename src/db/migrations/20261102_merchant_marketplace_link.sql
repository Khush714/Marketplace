CREATE TABLE IF NOT EXISTS "merchant_integration_links" (
  "restaurant_id" integer PRIMARY KEY REFERENCES "restaurants"("id") ON DELETE CASCADE,
  "merchant_business_id" text NOT NULL UNIQUE,
  "token_hash" text NOT NULL UNIQUE,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "merchant_integration_links_business_idx"
  ON "merchant_integration_links" ("merchant_business_id");

ALTER TABLE "restaurants"
  ADD COLUMN IF NOT EXISTS "merchant_pickup_enabled" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "merchant_delivery_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "merchant_hours_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "merchant_opens_at" text NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS "merchant_closes_at" text NOT NULL DEFAULT '22:00';

CREATE INDEX IF NOT EXISTS "restaurants_integration_one_time_passkey_hash_idx"
  ON "restaurants" ("integration_one_time_passkey_hash");
