-- Free Google Sign-In for customer accounts, additive to the existing phone/OTP
-- login. A Google-only account has NO phone number: phone_e164 and
-- phone_verified_at stay NULL for it. Phone/OTP accounts keep their unique,
-- verified phone number and the entire OTP challenge flow is unchanged; those
-- rows simply have NULL email/google_sub. Neither identifier is synthesized for
-- the other path, and an account is only updated by the path that owns it.
-- Each statement is idempotent so replaying this migration is a no-op.

-- Google-only accounts have no phone, and no OTP verification to record.
ALTER TABLE "customer_accounts" ALTER COLUMN "phone_e164" DROP NOT NULL;

-- Normalized (trimmed, lowercase) Google profile email and stable Google "sub".
ALTER TABLE "customer_accounts" ADD COLUMN IF NOT EXISTS "email" text;
ALTER TABLE "customer_accounts" ADD COLUMN IF NOT EXISTS "google_sub" text;

-- One account per Google identity / email. NULLs are not considered equal by a
-- unique index, so phone-only accounts (NULL email/google_sub) are unaffected
-- and may coexist. The existing phone unique index is kept as-is.
CREATE UNIQUE INDEX IF NOT EXISTS "customer_accounts_email_idx"
  ON "customer_accounts" ("email");
CREATE UNIQUE INDEX IF NOT EXISTS "customer_accounts_google_sub_idx"
  ON "customer_accounts" ("google_sub");
