-- Phase 10 (10.2) — FK ON DELETE / ON UPDATE review, applied.
--
-- Verdicts (src/db/schema.ts mirrors all three changed constraints; ON UPDATE
-- is unchanged everywhere — every FK in this schema points at an immutable
-- serial primary key, so there is nothing a cascade-on-update could move):
--
--   orders.restaurant_id               NO ACTION -> RESTRICT
--     Orders are financial records. Restaurant erasure deletes them only via
--     the explicit DELETE in deleteRestaurantById (same transaction as the
--     payment/delivery journal cleanup, which rides the orders cascade). The
--     FK now says out loud that no other path may remove them as a side
--     effect — a half-implemented delete fails loudly instead of quietly
--     destroying revenue history.
--
--   integration_sessions.restaurant_id NO ACTION -> CASCADE
--     Mirrors restaurant_sessions: a live POS token for a restaurant that no
--     longer exists is an orphaned credential.
--
--   connections.restaurant_id          NO ACTION -> CASCADE
--     The redemption binding is meaningless without its restaurant. reset and
--     deleteRestaurantById already deleted connections first; db:seed deleted
--     restaurants WITHOUT touching connections and only worked while no
--     connection existed. The cascade makes that path correct too. The
--     connection_codes row survives (status history), as revokeConnectionCode
--     documents.
--
--   connections.code_id and integration_sessions.code_id stay NO ACTION:
--     Connection codes are append-only history — revoke flips `status`, never
--     deletes the row — so NO ACTION is the guard that keeps a redeemed code
--     from vanishing under its connection/session. Deliberately unchanged.
--
-- Each block is idempotent: it discovers the live constraint (the base tables
-- predate the migration ledger, so their names are whatever drizzle-kit push
-- created), skips when the action already matches, and otherwise re-adds it
-- with the stable name drizzle computes from schema.ts — that name match is
-- what keeps a future `db:push` from dropping/re-adding the constraint forever.

-- orders -> restaurants: RESTRICT (financial records; see verdict above).
DO $$
DECLARE
  existing RECORD;
  want CONSTANT text := 'orders_restaurant_id_restaurants_id_fk';
BEGIN
  SELECT conname, confdeltype INTO existing
    FROM pg_constraint
   WHERE conrelid = 'orders'::regclass
     AND confrelid = 'restaurants'::regclass
     AND contype = 'f';

  IF FOUND THEN
    IF existing.confdeltype = 'r' THEN
      IF existing.conname <> want THEN
        EXECUTE format(
          'ALTER TABLE orders RENAME CONSTRAINT %I TO %I', existing.conname, want
        );
      END IF;
      RETURN;
    END IF;
    EXECUTE format('ALTER TABLE orders DROP CONSTRAINT %I', existing.conname);
  END IF;

  ALTER TABLE orders
    ADD CONSTRAINT orders_restaurant_id_restaurants_id_fk
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE RESTRICT;
END $$;

-- integration_sessions -> restaurants: CASCADE (no orphaned live credentials).
DO $$
DECLARE
  existing RECORD;
  want CONSTANT text := 'integration_sessions_restaurant_id_restaurants_id_fk';
BEGIN
  SELECT conname, confdeltype INTO existing
    FROM pg_constraint
   WHERE conrelid = 'integration_sessions'::regclass
     AND confrelid = 'restaurants'::regclass
     AND contype = 'f';

  IF FOUND THEN
    IF existing.confdeltype = 'c' THEN
      IF existing.conname <> want THEN
        EXECUTE format(
          'ALTER TABLE integration_sessions RENAME CONSTRAINT %I TO %I',
          existing.conname, want
        );
      END IF;
      RETURN;
    END IF;
    EXECUTE format('ALTER TABLE integration_sessions DROP CONSTRAINT %I', existing.conname);
  END IF;

  ALTER TABLE integration_sessions
    ADD CONSTRAINT integration_sessions_restaurant_id_restaurants_id_fk
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE;
END $$;

-- connections -> restaurants: CASCADE (binding dies with the restaurant).
DO $$
DECLARE
  existing RECORD;
  want CONSTANT text := 'connections_restaurant_id_restaurants_id_fk';
BEGIN
  SELECT conname, confdeltype INTO existing
    FROM pg_constraint
   WHERE conrelid = 'connections'::regclass
     AND confrelid = 'restaurants'::regclass
     AND contype = 'f';

  IF FOUND THEN
    IF existing.confdeltype = 'c' THEN
      IF existing.conname <> want THEN
        EXECUTE format(
          'ALTER TABLE connections RENAME CONSTRAINT %I TO %I', existing.conname, want
        );
      END IF;
      RETURN;
    END IF;
    EXECUTE format('ALTER TABLE connections DROP CONSTRAINT %I', existing.conname);
  END IF;

  ALTER TABLE connections
    ADD CONSTRAINT connections_restaurant_id_restaurants_id_fk
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE;
END $$;
