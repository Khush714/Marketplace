-- PHASE 35 — External ids.
-- The marketplace mapping layer: every syncable menu row carries BOTH a
-- marketplace id (item_…/cat_…/menu_…, created earlier) AND an external id
-- the POS/chain system publishes (e.g. pos_item_829).
--
--   Marketplace "Butter Chicken" item_123  <->  RestaurantAI "Butter Chicken" pos_item_829
--
-- The one-to-one guarantee lives in a per-restaurant unique index on
-- (restaurant_id, external_id): the same external id can never point at two
-- marketplace rows inside one restaurant, which is exactly what causes
-- synchronization drift later. Additive only; rows are never rewritten.

-- ---------------------------------------------------------------------------
-- categories.external_id (menu_items/menus already carry one)
-- ---------------------------------------------------------------------------
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "external_id" varchar(80);

-- ---------------------------------------------------------------------------
-- Scoped uniqueness per restaurant (empty strings are excluded, since NULL is
-- already ignored by unique indexes and empty external ids are meaningless).
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "menu_items_external_key"
  ON "menu_items" ("restaurant_id", "external_id")
  WHERE length(btrim("external_id")) > 0;

CREATE UNIQUE INDEX IF NOT EXISTS "categories_external_key"
  ON "categories" ("restaurant_id", "external_id")
  WHERE length(btrim("external_id")) > 0;

CREATE UNIQUE INDEX IF NOT EXISTS "menus_external_key"
  ON "menus" ("restaurant_id", "external_id")
  WHERE length(btrim("external_id")) > 0;