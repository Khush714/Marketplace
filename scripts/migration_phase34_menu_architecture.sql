-- PHASE 34 — Menu architecture.
-- Completes the hierarchy Restaurant -> Menu -> Category -> Item -> Modifiers:
--   * permanent marketplace ids on menus/categories/menu_items (menu_/cat_/item_
--     prefixes mirroring restaurants.marketplace_id rst_ scheme),
--   * categories.menu_id ownership pointer to the (default) menu container.
-- Additive only; existing rows are backfilled, never rewritten. The POS's own
-- rows remain authoritative in categories + menu_items.

-- ---------------------------------------------------------------------------
-- marketplace_id columns (nullable first, backfilled, then locked NOT NULL)
-- ---------------------------------------------------------------------------
ALTER TABLE "menus" ADD COLUMN IF NOT EXISTS "marketplace_id" varchar(24);
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "marketplace_id" varchar(24);
ALTER TABLE "menu_items" ADD COLUMN IF NOT EXISTS "marketplace_id" varchar(24);

-- ---------------------------------------------------------------------------
-- categories.menu_id — optional ownership pointer to the menu container
-- ---------------------------------------------------------------------------
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "menu_id" integer;

-- Make sure every restaurant has a default menu before attaching categories.
INSERT INTO "menus" ("restaurant_id", "name", "is_default", "source")
SELECT r."id", 'Menu', true, 'manual'
FROM "restaurants" r
WHERE NOT EXISTS (
  SELECT 1 FROM "menus" m
  WHERE m."restaurant_id" = r."id" AND m."is_default" = true
);

-- ---------------------------------------------------------------------------
-- Backfill: deterministic ids derived from the row's id (guaranteed unique).
-- App-level inserts now generate their own prefix_<base36> id via format.ts.
-- ---------------------------------------------------------------------------
UPDATE "menus" SET "marketplace_id" = 'menu_' || lpad(to_hex("id"), 8, '0')
WHERE "marketplace_id" IS NULL OR "marketplace_id" = '';

UPDATE "categories" SET "marketplace_id" = 'cat_' || lpad(to_hex("id"), 8, '0')
WHERE "marketplace_id" IS NULL OR "marketplace_id" = '';

UPDATE "menu_items" SET "marketplace_id" = 'item_' || lpad(to_hex("id"), 8, '0')
WHERE "marketplace_id" IS NULL OR "marketplace_id" = '';

ALTER TABLE "menus" ALTER COLUMN "marketplace_id" SET NOT NULL;
ALTER TABLE "categories" ALTER COLUMN "marketplace_id" SET NOT NULL;
ALTER TABLE "menu_items" ALTER COLUMN "marketplace_id" SET NOT NULL;

-- ---------------------------------------------------------------------------
-- Unique constraints (protect against duplicate backfill on re-runs)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menus_marketplace_id_key') THEN
    ALTER TABLE "menus" ADD CONSTRAINT "menus_marketplace_id_key" UNIQUE ("marketplace_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categories_marketplace_id_key') THEN
    ALTER TABLE "categories" ADD CONSTRAINT "categories_marketplace_id_key" UNIQUE ("marketplace_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_items_marketplace_id_key') THEN
    ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_marketplace_id_key" UNIQUE ("marketplace_id");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "categories_menu_idx" ON "categories" ("menu_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categories_menu_id_fkey') THEN
    ALTER TABLE "categories"
      ADD CONSTRAINT "categories_menu_id_fkey"
      FOREIGN KEY ("menu_id") REFERENCES "menus"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Attach existing categories to their restaurant's default menu (if any).
-- ---------------------------------------------------------------------------
UPDATE "categories" c
SET "menu_id" = m."id"
FROM "menus" m
WHERE c."menu_id" IS NULL
  AND m."restaurant_id" = c."restaurant_id"
  AND m."is_default" = true;