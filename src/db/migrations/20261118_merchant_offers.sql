-- Promotions for a Marketplace listing. The Merchant App proxies its Offers
-- screen to /api/integration/merchant/offers; without this table that route
-- cannot exist and the paired console reports "Marketplace request failed".
-- One source of truth: promo codes live here, never in the Merchant App for a
-- paired listing.
CREATE TABLE IF NOT EXISTS public.merchant_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  restaurant_id integer NOT NULL,
  code text NOT NULL,
  title text NOT NULL,
  description text DEFAULT '' NOT NULL,
  discount_type text NOT NULL,
  value integer NOT NULL,
  min_order integer DEFAULT 0 NOT NULL,
  max_discount integer,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  usage_limit integer,
  active boolean DEFAULT true NOT NULL,
  archived boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  -- Resolve the target through the session search_path. Some deployments keep
  -- the Marketplace tables outside `public`; a hard-coded public.restaurants
  -- would abort the whole migration there even though the table exists.
  IF to_regclass('restaurants') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'merchant_offers_restaurant_id_fkey'
     ) THEN
    ALTER TABLE public.merchant_offers
      ADD CONSTRAINT merchant_offers_restaurant_id_fkey
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS merchant_offers_restaurant_code_idx
  ON public.merchant_offers USING btree (restaurant_id, code);
CREATE INDEX IF NOT EXISTS merchant_offers_restaurant_active_idx
  ON public.merchant_offers USING btree (restaurant_id, active, archived);
