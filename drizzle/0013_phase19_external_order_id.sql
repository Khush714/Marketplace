-- PHASE 19 — capture the POS's own order reference on marketplace orders.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS external_order_id varchar(80);

CREATE INDEX IF NOT EXISTS orders_external_order_idx ON orders (external_order_id);