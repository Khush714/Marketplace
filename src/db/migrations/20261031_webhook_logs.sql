-- Inbound webhook audit trail.
--
-- Mirrors src/db/schema.ts (`webhookLogs`) so a plain `npm run db:push` and
-- this file agree. Additive and safe against a live database.
--
-- Rows are written by webhook receivers that need an operator-visible record of
-- rejected frames. Payloads may contain customer PII, so access is restricted
-- to the application role like every other table and nothing here is exposed
-- through a public route.
--
-- Run via: node scripts/db-migrate.mjs

CREATE TABLE IF NOT EXISTS "webhook_logs" (
  "id" serial PRIMARY KEY,
  "provider" text NOT NULL,
  "restaurant_id" text,
  "order_id" text,
  "status" text NOT NULL,
  "http_status_code" integer NOT NULL,
  "raw_headers" jsonb,
  "payload" jsonb,
  "error_message" text,
  "ip_address" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- Audit views filter by provider and by the order a frame claimed to concern.
CREATE INDEX IF NOT EXISTS "webhook_logs_provider_created_at_idx"
  ON "webhook_logs" ("provider", "created_at");

CREATE INDEX IF NOT EXISTS "webhook_logs_order_id_idx"
  ON "webhook_logs" ("order_id");
