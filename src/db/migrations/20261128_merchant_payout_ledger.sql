-- Marketplace-owned payout ledger foundation.
--
-- This migration records payout policy and immutable money snapshots only. It
-- does not configure a bank-transfer provider and does not move money. A future
-- processor may append outbox jobs, but every priced settlement is globally
-- unique per restaurant so two batches can never pay the same captured payment.
CREATE TABLE IF NOT EXISTS public.merchant_payout_settings (
  id serial PRIMARY KEY,
  restaurant_id integer NOT NULL UNIQUE
    REFERENCES public.restaurants(id) ON DELETE CASCADE,
  cycle text NOT NULL DEFAULT 'weekly',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS merchant_payout_settings_restaurant_idx
  ON public.merchant_payout_settings (restaurant_id);

CREATE TABLE IF NOT EXISTS public.merchant_payout_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  restaurant_id integer NOT NULL
    REFERENCES public.restaurants(id) ON DELETE RESTRICT,
  reference text NOT NULL UNIQUE,
  idempotency_key text NOT NULL,
  cycle text NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'PREVIEW',
  currency text NOT NULL DEFAULT 'INR',
  gross_cents integer NOT NULL DEFAULT 0,
  commission_cents integer NOT NULL DEFAULT 0,
  refund_cents integer NOT NULL DEFAULT 0,
  adjustment_cents integer NOT NULL DEFAULT 0,
  net_cents integer NOT NULL DEFAULT 0,
  line_count integer NOT NULL DEFAULT 0,
  checksum text NOT NULL,
  approved_at timestamptz,
  paid_at timestamptz,
  failure_code text,
  failure_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS merchant_payout_batches_restaurant_idem_idx
  ON public.merchant_payout_batches (restaurant_id, idempotency_key);

CREATE INDEX IF NOT EXISTS merchant_payout_batches_restaurant_idx
  ON public.merchant_payout_batches (restaurant_id, created_at);

CREATE INDEX IF NOT EXISTS merchant_payout_batches_status_idx
  ON public.merchant_payout_batches (status);

CREATE TABLE IF NOT EXISTS public.merchant_payout_batch_lines (
  id serial PRIMARY KEY,
  restaurant_id integer NOT NULL
    REFERENCES public.restaurants(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL
    REFERENCES public.merchant_payout_batches(id) ON DELETE RESTRICT,
  settlement_external_id text NOT NULL,
  marketplace_order_id text NOT NULL,
  gross_cents integer NOT NULL DEFAULT 0,
  commission_cents integer NOT NULL DEFAULT 0,
  refund_cents integer NOT NULL DEFAULT 0,
  adjustment_cents integer NOT NULL DEFAULT 0,
  net_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'INR',
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS merchant_payout_lines_batch_settlement_idx
  ON public.merchant_payout_batch_lines (batch_id, settlement_external_id);

CREATE UNIQUE INDEX IF NOT EXISTS merchant_payout_lines_restaurant_settlement_idx
  ON public.merchant_payout_batch_lines (restaurant_id, settlement_external_id);

CREATE INDEX IF NOT EXISTS merchant_payout_lines_batch_idx
  ON public.merchant_payout_batch_lines (batch_id);

CREATE TABLE IF NOT EXISTS public.merchant_payout_outbox (
  id serial PRIMARY KEY,
  restaurant_id integer NOT NULL
    REFERENCES public.restaurants(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL
    REFERENCES public.merchant_payout_batches(id) ON DELETE RESTRICT,
  event_id text NOT NULL UNIQUE,
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  locked_at timestamptz,
  last_error text,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS merchant_payout_outbox_status_attempt_idx
  ON public.merchant_payout_outbox (status, next_attempt_at);

CREATE INDEX IF NOT EXISTS merchant_payout_outbox_batch_idx
  ON public.merchant_payout_outbox (batch_id);

CREATE TABLE IF NOT EXISTS public.merchant_payout_events (
  id serial PRIMARY KEY,
  restaurant_id integer NOT NULL
    REFERENCES public.restaurants(id) ON DELETE RESTRICT,
  batch_id uuid REFERENCES public.merchant_payout_batches(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS merchant_payout_events_restaurant_idx
  ON public.merchant_payout_events (restaurant_id, created_at);

CREATE INDEX IF NOT EXISTS merchant_payout_events_batch_idx
  ON public.merchant_payout_events (batch_id);
