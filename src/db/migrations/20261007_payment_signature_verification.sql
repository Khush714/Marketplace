-- Phase 9: record whether a signature-verified provider channel put the payment
-- in the status it now holds. Mirrors src/db/schema.ts so `npm run db:push`
-- and this file agree.
-- Run via: node scripts/db-migrate.mjs

-- The Marketplace's rule for marking an order PAID is "the provider said so",
-- proved by an HMAC the client cannot produce: the webhook's
-- x-razorpay-signature over the raw body, or checkout.js's
-- order_id|payment_id|signature triple checked with the key secret. The local
-- dev stand-in has no such signature, and a fresh PAYMENT_PENDING row has not
-- heard from the provider at all.
--
-- This column is that fact, per row: true only when the current status was
-- applied through a channel whose payload carried a signature this server
-- verified. Existing rows keep the default (false) — they were written before
-- the provenance was tracked, and asserting verification for history we did
-- not record would be a lie. The webhook keeps proving them if they re-arrive.

ALTER TABLE "marketplace_payments"
  ADD COLUMN IF NOT EXISTS "signature_verified" boolean NOT NULL DEFAULT false;
