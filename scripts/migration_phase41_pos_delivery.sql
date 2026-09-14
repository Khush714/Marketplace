-- PHASE 16 — POS order delivery tracking (failure handling).
-- The marketplace queue delivers each order to the restaurant's POS via
-- webhook_events. These columns surface that delivery on the order itself so
-- an admin can see "pending / queued / delivering / delivered / failed", how
-- many attempts the outbox made, the last failure reason, and when the POS
-- finally acked the event.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS pos_delivery_status varchar(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS pos_delivery_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pos_last_delivery_error text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS pos_delivered_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS orders_pos_delivery_idx ON orders (pos_delivery_status);