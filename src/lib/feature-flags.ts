/**
 * Feature flags.
 *
 * PHASE 20 — the marketplace ordering engine is preserved, not deleted.
 * It is switched OFF by default because the redirect architecture
 * (restaurant_marketplace_profiles.menu_url) is the current product direction.
 *
 * Set MARKETPLACE_ORDERING_ENABLED=1 to reactivate the in-marketplace
 * ordering pipeline (placeOrder, order tracking, cancellation) without any
 * code change — the business logic in src/lib/marketplace.ts,
 * src/lib/pricing.ts, src/lib/order-actions.ts and src/lib/pos.ts is intact.
 */
export const marketplaceOrderingEnabled =
  process.env.MARKETPLACE_ORDERING_ENABLED === "1";

export const ORDERING_DISABLED_MESSAGE =
  "Marketplace ordering is disabled. Customers order directly from the restaurant via its menu link.";
