-- PHASE 33 — Restaurant connection system (Phase 4 completion).
-- Adds the webhook signing secret + connected_at timestamp to the integration
-- record. Additive; existing rows are backfilled, never rewritten.
--
-- The POS authorizes a connection by presenting the connection code + the
-- webhook secret. `connected_at` is set the moment the integration settles
-- into `connected` and cleared again on disconnect/error.
--
-- NOTE: the empty-string default is written as a dollar-quoted literal so the
-- migration runner's statement splitter (which treats a bare `''` as the start
-- of a quoted string) keeps these statements separate.

ALTER TABLE "restaurant_integrations"
  ADD COLUMN IF NOT EXISTS "webhook_secret" varchar(64) NOT NULL DEFAULT $empty$ $empty$;

ALTER TABLE "restaurant_integrations"
  ADD COLUMN IF NOT EXISTS "connected_at" timestamp with time zone;

-- Backfill: derive a stable pseudo-random secret for existing records that
-- were created before this column existed. App-level inserts now generate a
-- real 48-char hex secret via src/lib/integrations.ts.
UPDATE "restaurant_integrations"
SET "webhook_secret" = md5(random()::text || clock_timestamp()::text)
WHERE "webhook_secret" = $empty$ $empty$
   OR "webhook_secret" IS NULL;