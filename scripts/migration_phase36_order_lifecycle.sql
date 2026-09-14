-- PHASE 9 — canonical order lifecycle architecture.
-- Adds the lifecycle timestamps for the contract states that replaced the
-- single "completed" terminal: picked_up and delivered; plus rejected (the
-- PLACED → REJECTED edge). `completed_at` is kept for historical rows.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS rejected_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS picked_up_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS delivered_at timestamp with time zone;