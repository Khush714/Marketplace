-- Customer and partner "table stakes" state: server-backed carts, tips,
-- scheduled orders, review photos and tenant-scoped uploaded media. Money is
-- still integer paise; the browser can nominate a tip or a slot but never a
-- bill, a captured state, or an image owned by another tenant.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS tip_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz,
  ADD COLUMN IF NOT EXISTS review_photo_ids integer[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS public.customer_carts (
  id serial PRIMARY KEY,
  account_id integer NOT NULL
    REFERENCES public.customer_accounts(id) ON DELETE CASCADE,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_carts_account_unique
  ON public.customer_carts (account_id);

-- Uploaded bytes stay in the private database and are served through a guarded
-- route. A tenant-scoped id is the only public handle; no storage credential is
-- needed in the browser and the existing image host allowlist is not widened.
CREATE TABLE IF NOT EXISTS public.media_assets (
  id serial PRIMARY KEY,
  restaurant_id integer NOT NULL
    REFERENCES public.restaurants(id) ON DELETE CASCADE,
  order_id integer REFERENCES public.orders(id) ON DELETE CASCADE,
  kind text NOT NULL,
  content_type text NOT NULL,
  byte_size integer NOT NULL,
  data_base64 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS media_assets_restaurant_kind_idx
  ON public.media_assets (restaurant_id, kind);
CREATE INDEX IF NOT EXISTS media_assets_order_idx ON public.media_assets (order_id);

CREATE INDEX IF NOT EXISTS integration_audit_created_idx
  ON public.integration_audit (created_at DESC, id DESC);

REVOKE ALL ON TABLE public.customer_carts FROM PUBLIC;
REVOKE ALL ON TABLE public.media_assets FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.customer_carts FROM anon;
    REVOKE ALL ON TABLE public.media_assets FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.customer_carts FROM authenticated;
    REVOKE ALL ON TABLE public.media_assets FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'marketplace_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customer_carts TO marketplace_app;
    GRANT USAGE, SELECT ON SEQUENCE public.customer_carts_id_seq TO marketplace_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.media_assets TO marketplace_app;
    GRANT USAGE, SELECT ON SEQUENCE public.media_assets_id_seq TO marketplace_app;
  END IF;
END $$;
