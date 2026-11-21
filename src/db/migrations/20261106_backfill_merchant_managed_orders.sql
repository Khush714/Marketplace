-- Orders that predate the Merchant App lifecycle still belong to their linked
-- listing. Seed the merchant inbox with a faithful status so the Merchant App
-- can manage orders that were already in flight when the tables were created.
-- Without this, every historical order stays invisible (`merchant_managed`
-- defaults to false) and a freshly connected Merchant App shows an empty inbox.
UPDATE orders o
SET merchant_managed = true,
    merchant_status = CASE o.integration_status
      WHEN 'ACCEPTED' THEN 'ACCEPTED'
      WHEN 'PREPARING' THEN 'PREPARING'
      WHEN 'READY' THEN 'READY'
      WHEN 'OUT_FOR_DELIVERY' THEN 'OUT_FOR_DELIVERY'
      WHEN 'DELIVERED' THEN 'COMPLETED'
      WHEN 'COMPLETED' THEN 'COMPLETED'
      WHEN 'REJECTED' THEN 'REJECTED'
      WHEN 'CANCELLED' THEN 'CANCELLED'
      ELSE 'PLACED'
    END,
    merchant_status_updated_at = coalesce(o.status_updated_at, o.created_at)
WHERE o.merchant_managed = false
  AND EXISTS (
    SELECT 1 FROM merchant_app_links m WHERE m.restaurant_id = o.restaurant_id
  );
