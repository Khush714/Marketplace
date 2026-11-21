-- Order-scoped support threads for the in-app chat. A thread belongs to exactly
-- one order, so the existing HMAC order token is the customer's capability and
-- a conversation can never be attributed to the wrong order. Ops replies are
-- platform-wide and gated by x-ops-token at the route, not by a database role.
CREATE TABLE IF NOT EXISTS public.support_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  order_id integer NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  restaurant_id integer NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'OPEN',
  message_count integer NOT NULL DEFAULT 0,
  last_message text NOT NULL DEFAULT '',
  last_author_role text NOT NULL DEFAULT 'CUSTOMER',
  last_message_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The customer write path upserts on this index, so two tabs sending at once
-- cannot create two threads for one order.
CREATE UNIQUE INDEX IF NOT EXISTS support_threads_order_id_unique
  ON public.support_threads USING btree (order_id);

CREATE INDEX IF NOT EXISTS support_threads_restaurant_status_idx
  ON public.support_threads USING btree (restaurant_id, status, last_message_at);

CREATE INDEX IF NOT EXISTS support_threads_status_last_message_idx
  ON public.support_threads USING btree (status, last_message_at);

-- Append-only history. ON DELETE CASCADE mirrors the schema: a thread without
-- its order has no meaning, and deleting the order removes the conversation.
CREATE TABLE IF NOT EXISTS public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  thread_id uuid NOT NULL REFERENCES public.support_threads(id) ON DELETE CASCADE,
  author_role text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_messages_thread_created_idx
  ON public.support_messages USING btree (thread_id, created_at);

-- States are exactly the two the writer emits. Added by name so replaying this
-- file never stacks duplicate constraints.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'support_threads_status_check' AND conrelid = 'public.support_threads'::regclass
  ) THEN
    ALTER TABLE public.support_threads
      ADD CONSTRAINT support_threads_status_check
      CHECK (status IN ('OPEN', 'RESOLVED'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'support_messages_author_role_check' AND conrelid = 'public.support_messages'::regclass
  ) THEN
    ALTER TABLE public.support_messages
      ADD CONSTRAINT support_messages_author_role_check
      CHECK (author_role IN ('CUSTOMER', 'OPS'));
  END IF;
END $$;
