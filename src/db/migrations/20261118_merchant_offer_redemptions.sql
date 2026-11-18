-- Merchant-created promo codes are accepted at Marketplace checkout. Stamping
-- the chosen code on the order is what makes the offer's usage limit and the
-- Merchant App's redemptions count real: the discount itself was already stored
-- in discount_cents, but there was no way to attribute it to a promotion.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS offer_code text;

CREATE INDEX IF NOT EXISTS orders_restaurant_offer_code_idx
  ON public.orders USING btree (restaurant_id, offer_code);
