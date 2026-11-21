-- Preserve Merchant App pairings created before the integration tables were
-- renamed. `merchant_integration_links` was the original per-business link
-- table (restaurant_id, merchant_business_id, token_hash); the API now reads
-- `merchant_app_links` (restaurant_id, business_id, access_token_hash).
--
-- Copying the rows keeps already-paired Merchant businesses connected across
-- the rename. The source table only exists in databases that predate this
-- schema, so the whole copy is guarded and a no-op on fresh databases.
DO $$
BEGIN
  IF to_regclass('public.merchant_integration_links') IS NOT NULL THEN
    INSERT INTO merchant_app_links (restaurant_id, business_id, access_token_hash, created_at)
    SELECT restaurant_id, merchant_business_id, token_hash, created_at
    FROM merchant_integration_links
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
