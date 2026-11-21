-- Add optional gendered avatar selection to customer accounts.
-- Values are application-validated: "male", "female", or "" (unset).

ALTER TABLE "customer_accounts"
  ADD COLUMN IF NOT EXISTS "avatar" text NOT NULL DEFAULT '';
