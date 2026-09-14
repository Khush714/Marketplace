-- PHASE 12 — store the raw integration API key for outbound presentation.
-- The marketplace presents this key when calling RestaurantAI's endpoint_url.
-- A separate api_key_hash column (already exists) stores the SHA-256 for
-- RestaurantAI-side verification. This column stores the raw key the
-- marketplace needs to present; it never leaves the server.
ALTER TABLE restaurant_integrations
  ADD COLUMN IF NOT EXISTS api_key_raw text NOT NULL DEFAULT '';
