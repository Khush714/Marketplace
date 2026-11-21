CREATE TABLE IF NOT EXISTS "delivery_mirror_jobs" (
  "id" serial PRIMARY KEY NOT NULL,
  "order_id" integer NOT NULL,
  "restaurant_id" integer NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "owner" text DEFAULT 'merchant' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "delivery_mirror_jobs_order_idx" ON "delivery_mirror_jobs" ("order_id");
CREATE INDEX IF NOT EXISTS "delivery_mirror_jobs_restaurant_idx" ON "delivery_mirror_jobs" ("restaurant_id");
