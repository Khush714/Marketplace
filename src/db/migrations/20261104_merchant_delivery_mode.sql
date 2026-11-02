ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS merchant_delivery_mode text;
