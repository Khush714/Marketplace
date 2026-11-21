-- Give the partner console real sessions instead of replaying the owner key.
-- Mirrors src/db/schema.ts so a plain `npm run db:push` and this file agree.
-- Run via: node scripts/db-migrate.mjs

-- The owner key was generated exactly once, shown exactly once, and is
-- unrecoverable. It was also the credential on every /api/partner/* request, which
-- made it a session with none of a session's properties: no expiry, no
-- revocation, no server-side record, and no way to end it short of rotating the
-- key itself — which invalidates the only copy the restaurant holds.
--
-- This adds the row that carries those properties. The owner key is NOT retired:
-- it stays as the recovery credential and is exchanged for one of these rows at
-- /api/partner/session. That is the whole point — recovery is a rare,
-- deliberate act; per-request authentication should not need a long-lived
-- secret at all.
--
-- Nothing here backfills. Existing partner clients keep working through the
-- session-establishment call, and a restaurant that has lost its owner key
-- already had no path back (that is intentional and unchanged), so there is no
-- row to invent on its behalf.
CREATE TABLE IF NOT EXISTS "restaurant_sessions" (
  "id" serial PRIMARY KEY,
  "token_hash" text NOT NULL,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants" ("id") ON DELETE CASCADE,
  -- Paired with the session token for double-submit CSRF. Cookie auth means the
  -- browser now attaches the credential automatically, so the header is the only
  -- thing proving the write came from this app's own JS rather than a form on
  -- another origin.
  "csrf_hash" text NOT NULL,
  -- Single-use confirmation for DELETE /api/partner/restaurant. Held on the
  -- session rather than in its own table because it has the same lifetime and
  -- the same blast radius: both are per-session, both are worthless without the
  -- session token, and both die together when the session is revoked.
  "delete_confirm_hash" text,
  "delete_confirm_expires_at" timestamptz,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "last_used_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- `token_hash` is already UNIQUE, so this index is the lookup path for every
-- authenticated request. Named explicitly to match the other token tables rather
-- than relying on the constraint's generated name.
CREATE INDEX IF NOT EXISTS "restaurant_sessions_token_hash_idx"
  ON "restaurant_sessions" ("token_hash");

-- Revoking every session for a restaurant on owner-key rotation is a scan on one
-- tenant's rows; without this it is a scan of the table.
CREATE INDEX IF NOT EXISTS "restaurant_sessions_restaurant_id_idx"
  ON "restaurant_sessions" ("restaurant_id");

-- The expiry sweep. Without it, reaping dead rows is a sequential scan that
-- degrades exactly as the table fills up with dead rows.
CREATE INDEX IF NOT EXISTS "restaurant_sessions_expires_at_idx"
  ON "restaurant_sessions" ("expires_at");
