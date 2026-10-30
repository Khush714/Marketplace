-- Custom cloud POS provider: per-listing outbound endpoint.
--
-- `custom_webhook` joins `restaurant-ai` and `petpooja` behind the same durable
-- delivery journal. Unlike those two, its endpoint is not process-wide config:
-- every listing points at a different POS, so the target has to live on the
-- integration record beside the sealed signing secret.
--
-- No backfill: a record is only given a URL by the ops onboarding call, and
-- NULL simply keeps every other provider (and any older record) exactly as it
-- was. Additive, so the migration is safe to run against a live database that
-- is still serving Restaurant AI and Petpooja orders.
--
-- Mirrors src/db/schema.ts (`integration_records.webhook_url`).
-- Run via: node scripts/db-migrate.mjs

ALTER TABLE "integration_records"
  ADD COLUMN IF NOT EXISTS "webhook_url" text;
