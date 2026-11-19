-- The paired Merchant App manages item stock through the integration API.
-- NULL keeps existing/POS-owned rows untracked; checkout treats zero as sold out
-- and decrements tracked quantities atomically when an order is created.
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS stock_quantity integer;
