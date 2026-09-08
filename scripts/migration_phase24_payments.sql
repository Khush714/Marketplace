-- PHASE 24 — Razorpay payments audit trail
CREATE TABLE IF NOT EXISTS "payments" (
  "id" serial PRIMARY KEY NOT NULL,
  "order_id" integer,
  "reference" varchar(24) NOT NULL,
  "razorpay_order_id" varchar(64) NOT NULL,
  "razorpay_payment_id" varchar(64),
  "razorpay_signature" varchar(128),
  "amount" numeric(10, 2) NOT NULL,
  "currency" varchar(8) DEFAULT 'INR' NOT NULL,
  "status" varchar(24) DEFAULT 'created' NOT NULL,
  "failure_reason" text,
  "refund_id" varchar(64),
  "refund_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
  "metadata" text DEFAULT '{}' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "payments_reference_key" ON "payments" ("reference");
CREATE INDEX IF NOT EXISTS "payments_order_idx" ON "payments" ("order_id");
CREATE INDEX IF NOT EXISTS "payments_razorpay_order_idx" ON "payments" ("razorpay_order_id");
CREATE INDEX IF NOT EXISTS "payments_status_idx" ON "payments" ("status");

ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE set null;