ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS merchant_fulfillment boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS orders_merchant_fulfillment_created_idx
  ON orders (restaurant_id, created_at DESC)
  WHERE merchant_fulfillment = true;
