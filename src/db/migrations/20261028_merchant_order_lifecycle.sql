-- First-party Marketplace ↔ Merchant App lifecycle; independent from POS lifecycle.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS merchant_managed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS merchant_status text NOT NULL DEFAULT 'PLACED',
  ADD COLUMN IF NOT EXISTS merchant_status_updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS merchant_prep_minutes integer,
  ADD COLUMN IF NOT EXISTS merchant_rejection_reason text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS merchant_fulfilment text NOT NULL DEFAULT 'delivery';

CREATE INDEX IF NOT EXISTS orders_restaurant_merchant_status_created_idx
  ON orders (restaurant_id, merchant_status, created_at DESC);

CREATE TABLE IF NOT EXISTS merchant_order_events (
  id serial PRIMARY KEY,
  order_id integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  restaurant_id integer NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  from_status text NOT NULL,
  to_status text NOT NULL,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS merchant_order_events_order_idx ON merchant_order_events (order_id);
CREATE INDEX IF NOT EXISTS merchant_order_events_restaurant_idx ON merchant_order_events (restaurant_id);


-- Marketplace ↔ Merchant App pairing and store controls.
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS merchant_hours_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS merchant_opens_at text NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS merchant_closes_at text NOT NULL DEFAULT '22:00',
  ADD COLUMN IF NOT EXISTS merchant_pickup_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS merchant_delivery_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS merchant_app_link_codes (
  id serial PRIMARY KEY,
  restaurant_id integer NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS merchant_app_link_codes_restaurant_idx ON merchant_app_link_codes (restaurant_id);

CREATE TABLE IF NOT EXISTS merchant_app_links (
  id serial PRIMARY KEY,
  restaurant_id integer NOT NULL UNIQUE REFERENCES restaurants(id) ON DELETE CASCADE,
  business_id text NOT NULL UNIQUE,
  access_token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS merchant_app_links_restaurant_idx ON merchant_app_links (restaurant_id);
