-- Paired Merchant App payout destinations are owned by Marketplace: Merchant
-- forwards the account over the integration API and keeps only a masked label.
-- encrypted_destination is an AES-256-GCM envelope, never a raw account number.
-- No KYC/verification state is introduced; 'configured' simply means stored.
CREATE TABLE IF NOT EXISTS public.merchant_payout_accounts (
  id serial PRIMARY KEY,
  restaurant_id integer NOT NULL UNIQUE
    REFERENCES public.restaurants(id) ON DELETE CASCADE,
  method text NOT NULL,
  encrypted_destination text NOT NULL,
  masked_label text NOT NULL,
  reference text,
  status text NOT NULL DEFAULT 'configured',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS merchant_payout_accounts_restaurant_idx
  ON public.merchant_payout_accounts (restaurant_id);
