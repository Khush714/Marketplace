-- PHASE 24 — Web Push subscriptions
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" serial PRIMARY KEY NOT NULL,
  "customer_id" integer NOT NULL,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "label" varchar(40) DEFAULT 'browser' NOT NULL,
  "last_sent_at" timestamp with time zone,
  "last_error" text,
  "revoked" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "push_subscriptions_customer_idx" ON "push_subscriptions" ("customer_id");
CREATE INDEX IF NOT EXISTS "push_subscriptions_endpoint_idx" ON "push_subscriptions" ("endpoint");

ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_customer_id_customers_id_fk"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE cascade;