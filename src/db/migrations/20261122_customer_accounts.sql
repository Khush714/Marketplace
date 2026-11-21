-- Customer accounts (Phase B foundation): authenticated identity, profile data,
-- and explicit/proven linking of orders for cross-device history.
--
-- Anonymous `customer_sessions` (cookie-bound order-code ownership) remain the
-- guest/compat path. Account sessions are separate so account auth/lifecycle
-- can evolve without conflating anonymous device ownership.
--
-- MVP assumptions encoded here (adjust in follow-up migrations if decisions
-- change): phone-number identity (E.164, unique), OTP challenges stored as
-- hashes with bounded attempts/TTL, explicit/proven order claiming only (no
-- auto-link by phone), and guest checkout remains supported.

CREATE TABLE IF NOT EXISTS "customer_accounts" (
  "id" serial PRIMARY KEY,
  "phone_e164" text NOT NULL,
  "phone_verified_at" timestamptz,
  "name" text NOT NULL DEFAULT '',
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "customer_accounts_phone_e164_idx"
  ON "customer_accounts" ("phone_e164");

CREATE TABLE IF NOT EXISTS "customer_auth_challenges" (
  "id" serial PRIMARY KEY,
  "phone_e164" text NOT NULL,
  "purpose" text NOT NULL DEFAULT 'login',
  -- One-time code, hashed at rest: a database read must not yield a usable OTP.
  "code_hash" text NOT NULL,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 5,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "customer_auth_challenges_phone_purpose_expires_idx"
  ON "customer_auth_challenges" ("phone_e164", "purpose", "expires_at");
CREATE INDEX IF NOT EXISTS "customer_auth_challenges_expires_at_idx"
  ON "customer_auth_challenges" ("expires_at");

CREATE TABLE IF NOT EXISTS "customer_account_sessions" (
  "id" serial PRIMARY KEY,
  "account_id" integer NOT NULL REFERENCES "customer_accounts" ("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "csrf_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "last_used_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "customer_account_sessions_token_hash_idx"
  ON "customer_account_sessions" ("token_hash");
CREATE INDEX IF NOT EXISTS "customer_account_sessions_account_id_idx"
  ON "customer_account_sessions" ("account_id");
CREATE INDEX IF NOT EXISTS "customer_account_sessions_expires_at_idx"
  ON "customer_account_sessions" ("expires_at");

CREATE TABLE IF NOT EXISTS "customer_addresses" (
  "id" serial PRIMARY KEY,
  "account_id" integer NOT NULL REFERENCES "customer_accounts" ("id") ON DELETE CASCADE,
  "label" text NOT NULL DEFAULT 'Other',
  "text" text NOT NULL,
  "is_default" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "customer_addresses_account_id_idx"
  ON "customer_addresses" ("account_id");

CREATE TABLE IF NOT EXISTS "customer_favorites" (
  "id" serial PRIMARY KEY,
  "account_id" integer NOT NULL REFERENCES "customer_accounts" ("id") ON DELETE CASCADE,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants" ("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "customer_favorites_account_restaurant_idx"
  ON "customer_favorites" ("account_id", "restaurant_id");
CREATE INDEX IF NOT EXISTS "customer_favorites_account_id_idx"
  ON "customer_favorites" ("account_id");

-- Explicit/proven order linking: orders placed/claimed by an account. Nullable
-- and additive; existing token/session ownership and guest checkout are unchanged.
-- SET NULL preserves financial/order records if an account is later removed.
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "customer_account_id" integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_customer_account_id_fkey'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE "orders"
      ADD CONSTRAINT "orders_customer_account_id_fkey"
      FOREIGN KEY ("customer_account_id") REFERENCES "customer_accounts" ("id")
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "orders_customer_account_id_idx"
  ON "orders" ("customer_account_id");
