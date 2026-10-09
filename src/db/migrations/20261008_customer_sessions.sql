-- Anonymous customer sessions: keep order capability out of localStorage.
-- Mirrors src/db/schema.ts so a plain `npm run db:push` and this file agree.
-- Run via: node scripts/db-migrate.mjs

-- Until now the browser stored every placed order as { code, token,
-- trackingToken } inside the shared profile blob (crave.profile.v1) — the
-- same object as the customer's name, phone and addresses. That made one
-- XSS read triple its yield: PII plus the signed credentials for every order
-- ever placed on the device. Moving the credential behind an HttpOnly cookie
-- means script can still *spend* it (same-origin fetches carry the cookie)
-- but cannot read a list of tokens out of storage to replay elsewhere.
--
-- The row holds order codes only — no name, no phone, no address — so a
-- leaked row is scoped to "which orders this browser may read", bounded by
-- expires_at, and revocable via revoked_at without touching the orders.
-- Nothing here backfills: existing browsers keep working through their
-- existing code+token pairs until the client attaches them to a session
-- (POST /api/orders/attach), which is the migration path rather than a
-- server-side guess at which browser placed which order.
CREATE TABLE IF NOT EXISTS "customer_sessions" (
  "id" serial PRIMARY KEY,
  -- The session token, hashed at rest like every other token in this schema:
  -- a database read must not yield a usable cookie.
  "token_hash" text NOT NULL,
  -- Order codes this session may read/cancel, newest first, capped by the
  -- client's history limit. jsonb rather than a join table: written once per
  -- checkout, read as a whole, never queried by code (see schema.ts).
  "order_codes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Bounded lifetime plus a kill switch — the two properties the localStorage
  -- credential had none of. Revocation is per-session so a lost device can be
  -- signed out without invalidating the orders themselves.
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "last_used_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- The lookup path for every authenticated request: the cookie carries the
-- token, this index resolves the row from its hash. Named explicitly to match
-- the other token tables rather than relying on a generated constraint name.
CREATE INDEX IF NOT EXISTS "customer_sessions_token_hash_idx"
  ON "customer_sessions" ("token_hash");

-- The expiry sweep. Without it, reaping dead rows is a sequential scan that
-- degrades exactly as the table fills up with dead sessions.
CREATE INDEX IF NOT EXISTS "customer_sessions_expires_at_idx"
  ON "customer_sessions" ("expires_at");
