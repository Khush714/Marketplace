-- Customers can rate a delivered order, and the paired Merchant App can reply
-- once. Stored on the order so the existing HMAC order token is also the review
-- capability and a review can never be attributed to the wrong order.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS rating integer,
  ADD COLUMN IF NOT EXISTS review text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS feedback_at timestamptz,
  ADD COLUMN IF NOT EXISTS merchant_response text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS merchant_responded_at timestamptz;

-- Rating is only meaningful when a review was actually submitted. The check is
-- added by name so replaying this file never stacks duplicate constraints.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'orders_rating_range_check' AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_rating_range_check
      CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS orders_restaurant_feedback_idx
  ON public.orders USING btree (restaurant_id, feedback_at);
