ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "external_id" varchar(80);

CREATE UNIQUE INDEX IF NOT EXISTS "menu_items_external_key"
  ON "menu_items" ("restaurant_id", "external_id")
  WHERE length(btrim("external_id")) > 0;

CREATE UNIQUE INDEX IF NOT EXISTS "categories_external_key"
  ON "categories" ("restaurant_id", "external_id")
  WHERE length(btrim("external_id")) > 0;

CREATE UNIQUE INDEX IF NOT EXISTS "menus_external_key"
  ON "menus" ("restaurant_id", "external_id")
  WHERE length(btrim("external_id")) > 0;