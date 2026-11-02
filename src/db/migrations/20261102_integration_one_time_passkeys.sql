-- Add a separately hashed, expiring credential for a partner-authorized POS login.
ALTER TABLE "restaurants"
  ADD COLUMN IF NOT EXISTS "integration_one_time_passkey_hash" text,
  ADD COLUMN IF NOT EXISTS "integration_one_time_passkey_expires_at" timestamptz;
