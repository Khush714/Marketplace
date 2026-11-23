-- Device-scoped customer notification inbox. Only SHA-256 hashes of random
-- browser tokens are stored; no account identity, contact details or raw token
-- ever reaches the database. Rows are deduped per (inbox hash, state change) so
-- replayed POS/payment webhooks cannot spam the same message twice.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_inbox_hash text;

CREATE TABLE IF NOT EXISTS public.customer_notifications (
  id serial PRIMARY KEY,
  -- Orders are financial records; an explicit order delete cascades its messages.
  order_id integer NOT NULL
    REFERENCES public.orders(id) ON DELETE CASCADE,
  restaurant_id integer NOT NULL
    REFERENCES public.restaurants(id) ON DELETE RESTRICT,
  inbox_hash text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  dedupe_key text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_notifications_inbox_dedupe_unique
  ON public.customer_notifications (inbox_hash, dedupe_key);
CREATE INDEX IF NOT EXISTS customer_notifications_inbox_created_idx
  ON public.customer_notifications (inbox_hash, created_at);

-- The migration runner/owner keeps full rights; the runtime role needs the same
-- DML access it has on the rest of the application tables. Supabase's anon and
-- authenticated roles must never read another device's inbox.
REVOKE ALL ON TABLE public.customer_notifications FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.customer_notifications FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.customer_notifications FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'marketplace_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customer_notifications TO marketplace_app;
    GRANT USAGE, SELECT ON SEQUENCE public.customer_notifications_id_seq TO marketplace_app;
  END IF;
END $$;
