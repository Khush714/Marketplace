-- Widen the POS identity columns from int4 to int8.
--
-- Every `menu.sync` for a currently-provisioned POS tenant fails with
-- [22003] integer out of range, surfaced to the POS as a bare "HTTP 500: null"
-- and left PENDING in marketplace_menu_sync_outbox forever. The handshake
-- itself is unaffected (it never touches these tables), which is why a tenant
-- can read "active" on both sides with an empty menu.
--
-- Cause: the POS mints menu_items.id as epoch milliseconds — BRAVO's items are
-- 1787818683670. Postgres `integer` tops out at 2147483647, so every insert
-- overflows by roughly three orders of magnitude. `readPosId` in menu-sync.ts
-- cannot help: the value is a valid positive int, just too wide for the column.
--
-- int4 -> int8 is lossless and non-destructive. No value changes, no index is
-- dropped, and the unique indexes below are preserved because the migration
-- widens their columns in place. Existing partner-authored rows keep their
-- negative synthetic ids, which still satisfy readPosId's `> 0` guard and
-- therefore still cannot be overwritten by a POS upsert.
--
-- All six columns are included, not just menu_items.pos_item_id. They share one
-- id scheme: a POS that stamps items with epoch-ms stamps its categories,
-- groups, and options the same way, so fixing only the column that happens to
-- overflow first would leave the next tenant broken on a different column.
--
-- Run via: psql "$DATABASE_URL" -f src/db/migrations/20261001_widen_pos_identity_columns_to_bigint.sql
--
-- Rollback (safe, and a no-op if no epoch-ms row has been synced yet):
--   ALTER TABLE menu_items          ALTER COLUMN pos_item_id     TYPE integer;
--   ALTER TABLE menu_items          ALTER COLUMN pos_category_id TYPE integer;
--   ALTER TABLE menu_categories     ALTER COLUMN pos_category_id TYPE integer;
--   ALTER TABLE modifier_groups     ALTER COLUMN pos_group_id    TYPE integer;
--   ALTER TABLE modifier_options    ALTER COLUMN pos_group_id    TYPE integer;
--   ALTER TABLE modifier_options    ALTER COLUMN pos_option_id   TYPE integer;

ALTER TABLE "menu_items"
  ALTER COLUMN "pos_item_id" TYPE bigint,
  ALTER COLUMN "pos_category_id" TYPE bigint;

ALTER TABLE "menu_categories"
  ALTER COLUMN "pos_category_id" TYPE bigint;

ALTER TABLE "modifier_groups"
  ALTER COLUMN "pos_group_id" TYPE bigint;

ALTER TABLE "modifier_options"
  ALTER COLUMN "pos_group_id" TYPE bigint,
  ALTER COLUMN "pos_option_id" TYPE bigint;
