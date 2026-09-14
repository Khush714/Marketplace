-- PHASE 19 — capture the POS's own order reference on marketplace orders.
-- Inbound order webhooks can optionally report an external order id different
-- from the marketplace reference (MKT-...). Store it here so future webhooks
-- can be keyed by either identity.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS external_order_id varchar(80);

CREATE INDEX IF NOT EXISTS orders_external_order_idx ON orders (external_order_id);