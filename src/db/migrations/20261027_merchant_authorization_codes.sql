CREATE TABLE IF NOT EXISTS merchant_authorization_codes (
  code_hash text PRIMARY KEY,
  restaurant_id integer NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  code_challenge text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS merchant_authorization_codes_expires_at_idx
  ON merchant_authorization_codes (expires_at);

CREATE INDEX IF NOT EXISTS merchant_authorization_codes_restaurant_idx
  ON merchant_authorization_codes (restaurant_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'marketplace_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE merchant_authorization_codes TO marketplace_app;
  END IF;
END $$;
