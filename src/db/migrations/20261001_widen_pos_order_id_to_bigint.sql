-- Widen the order-bridge POS id columns from int4 to int8.
--
-- Companion to 20261001_widen_pos_identity_columns_to_bigint.sql, which fixed the
-- same class of bug in the menu tables. The POS declares its id convention
-- explicitly — orders.js:393 sends `timestamp: Date.now()` described in-code as
-- "bigint epoch ms (existing convention)" — so any POS id stored in an int4
-- column is at risk the moment the id source changes. The menu tables proved it:
-- menu_items.pos_item_id overflowed on [22003] and silently emptied every linked
-- listing's menu while both systems reported themselves healthy.
--
-- These three columns are NOT currently overflowing: order ids are drawn from a
-- sequence (max 900573265, 41.9% of int4 max), so this is defence in depth rather
-- than an active break. Widening now costs one non-destructive ALTER; widening
-- after a tenant's orders start failing delivery, mid-trading, costs a rollback.
--
--   orders.pos_order_id                     — set when the POS acknowledges an order
--   marketplace_pos_order_deliveries.pos_order_id — delivery ledger
--   marketplace_order_events.pos_order_id   — inbound event log
--
-- The two marketplace_* tables were declared `integer` by
-- 20260922_marketplace_pos_order_bridge.sql; `orders` carries the same column via
-- the schema. All three are widened together so the bridge cannot half-apply.
--
-- int4 -> int8 is lossless and non-destructive: no value changes, no index is
-- dropped, and the unique index on marketplace_pos_order_deliveries
-- (pos_order_deliveries_external_order_id_unique) is untouched because
-- external_order_id is text and not being altered.
--
-- Run via: psql "$DATABASE_URL" -f src/db/migrations/20261001_widen_pos_order_id_to_bigint.sql
--
-- Rollback (safe while no order id above 2147483647 has been written):
--   ALTER TABLE orders                          ALTER COLUMN pos_order_id TYPE integer;
--   ALTER TABLE marketplace_pos_order_deliveries ALTER COLUMN pos_order_id TYPE integer;
--   ALTER TABLE marketplace_order_events        ALTER COLUMN pos_order_id TYPE integer;

ALTER TABLE "orders"
  ALTER COLUMN "pos_order_id" TYPE bigint;

ALTER TABLE "marketplace_pos_order_deliveries"
  ALTER COLUMN "pos_order_id" TYPE bigint;

ALTER TABLE "marketplace_order_events"
  ALTER COLUMN "pos_order_id" TYPE bigint;
