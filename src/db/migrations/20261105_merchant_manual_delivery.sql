ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS merchant_delivery_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS merchant_courier_name text,
  ADD COLUMN IF NOT EXISTS merchant_delivery_updated_at timestamptz;

UPDATE orders
SET merchant_delivery_status = 'delivered',
    merchant_delivery_updated_at = status_updated_at
WHERE merchant_fulfillment = true
  AND integration_status = 'COMPLETED'
  AND merchant_delivery_status = 'pending';
