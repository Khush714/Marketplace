-- PHASE 10 — unified order events audit trail.
-- A superset of order_status_events: every lifecycle transition plus
-- non-status domain events (payment confirmed/failed/refunded, sent to
-- restaurant, delivery assignment, rider leg). `meta` is a JSON payload.
CREATE TABLE IF NOT EXISTS order_events (
  id serial PRIMARY KEY,
  order_id integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type varchar(40) NOT NULL,
  actor varchar(24) NOT NULL DEFAULT 'system',
  from_status varchar(24),
  to_status varchar(24),
  meta text NOT NULL DEFAULT '{}',
  note text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_events_order_idx ON order_events (order_id, created_at);
CREATE INDEX IF NOT EXISTS order_events_type_idx ON order_events (type);