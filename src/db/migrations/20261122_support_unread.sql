-- Unread-state for order support threads. The customer reads the conversation
-- on a tracked order; without a server-side read watermark there is no way to
-- tell a reply they have already seen from one that arrived after they left.
--
-- NULL means "never acknowledged": a thread whose last author is OPS is then
-- unread, which is the correct state for every conversation that existed before
-- this column. A customer message or an explicit mark-read advances it. No
-- backfill is needed, and the column carries no PII — just a timestamp.
ALTER TABLE public.support_threads
  ADD COLUMN IF NOT EXISTS customer_last_read_at timestamptz;
