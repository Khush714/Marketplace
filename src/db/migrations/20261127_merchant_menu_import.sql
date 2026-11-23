-- Paired Merchant App full-menu import.
--
-- Stable external ids let Marketplace upsert the same dish/group/option across
-- repeated CSV imports instead of minting a new row each time. NULLs are left
-- alone so POS-owned and manually-created rows keep working unchanged.
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS external_id text;

-- Keep the CSV dietary enum lossless and separate temporary sold-out state from
-- an item the paired Merchant App removed from the desired menu.
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS dietary text;

ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

ALTER TABLE public.modifier_groups
  ADD COLUMN IF NOT EXISTS external_id text;

ALTER TABLE public.modifier_options
  ADD COLUMN IF NOT EXISTS external_id text;

CREATE UNIQUE INDEX IF NOT EXISTS menu_items_restaurant_external_id_idx
  ON public.menu_items (restaurant_id, external_id);

CREATE UNIQUE INDEX IF NOT EXISTS modifier_groups_restaurant_external_id_idx
  ON public.modifier_groups (restaurant_id, external_id);

CREATE UNIQUE INDEX IF NOT EXISTS modifier_options_group_external_id_idx
  ON public.modifier_options (group_id, external_id);

-- Replay ledger keyed by the paired outlet plus the Merchant preview id. The
-- stored result is immutable, so an exact retry never advances the revision a
-- second time and a reused key with a different payload is rejected.
CREATE TABLE IF NOT EXISTS public.merchant_menu_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  restaurant_id integer NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  import_id text NOT NULL,
  business_id text NOT NULL,
  payload_hash text NOT NULL,
  from_revision integer NOT NULL,
  to_revision integer NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS merchant_menu_imports_restaurant_import_idx
  ON public.merchant_menu_imports (restaurant_id, import_id);

CREATE INDEX IF NOT EXISTS merchant_menu_imports_restaurant_idx
  ON public.merchant_menu_imports (restaurant_id);
