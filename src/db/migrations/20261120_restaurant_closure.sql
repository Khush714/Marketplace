-- The paired Merchant App writes these fields through the integration API.
-- Discovery and checkout enforce them here so a closed kitchen cannot take
-- new orders even if the local Merchant App is offline.
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS closure_reason text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS closure_until timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_leaves jsonb NOT NULL DEFAULT '[]'::jsonb;
