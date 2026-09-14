-- PHASE 17 — Idempotency store.
--
-- Records a processed (scope, key) from inbound requests so a network-induced
-- retry (or any duplicate delivery) returns the cached response instead of
-- executing the side effect a second time. Both the marketplace's own inbound
-- receiver and the fake POS (as the reference RestaurantAI implementation)
-- use this table.
--
-- scope           — namespacing, e.g. 'restaurant:3' or 'integration:1'.
-- idempotency_key — stable dedup key derived from external_order_id / event_id.
-- request_hash    — SHA-256 of the request body; a replayed request with a
--                   DIFFERENT body for the same key is a 409 conflict.
-- response/status_code — the cached original response, so a retry is answered
--                   exactly like the first attempt was.
CREATE TABLE IF NOT EXISTS integration_idempotency (
  id serial PRIMARY KEY,
  scope varchar(80) NOT NULL,
  idempotency_key varchar(191) NOT NULL,
  request_hash varchar(64) NOT NULL,
  response text NOT NULL DEFAULT '{}',
  status_code integer NOT NULL DEFAULT 200,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, idempotency_key)
);