-- PHASE 13 — webhook_events: add event_id for inbound dedup and direction column.
-- event_id: the sender's unique event identifier (for idempotent delivery).
-- direction: 'outbound' (marketplace → POS, existing) or 'inbound' (POS → marketplace, new).
ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS event_id varchar(128),
  ADD COLUMN IF NOT EXISTS direction varchar(8) NOT NULL DEFAULT 'outbound';

-- Unique index: no duplicate inbound event processing.
CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_event_id_uniq
  ON webhook_events (event_id)
  WHERE event_id IS NOT NULL;

-- Inbound events query path: direction + status + created_at.
CREATE INDEX IF NOT EXISTS webhook_events_inbound_idx
  ON webhook_events (direction, status, created_at)
  WHERE direction = 'inbound';
