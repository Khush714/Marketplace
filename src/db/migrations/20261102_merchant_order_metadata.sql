ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "merchant_prep_minutes" integer,
  ADD COLUMN IF NOT EXISTS "merchant_rejection_reason" text NOT NULL DEFAULT '';
