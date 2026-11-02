import "server-only";

/**
 * Whether checkout requires a live fulfillment connection.
 *
 * Production requires either an ACTIVE POS integration or a paired Merchant
 * business. Merchant orders remain in the Marketplace's durable order store
 * and are retrieved through its authenticated integration API; POS orders use
 * the delivery journal. A restaurant with neither path cannot fulfil an order.
 *
 * Outside production the gate is open by default, because the seeded demo
 * restaurants have no integration record at all (src/db/seed.ts) and blocking
 * them would take local checkout down entirely. `MARKETPLACE_ORDERING_ENABLED`
 * overrides either direction, which is also how the gate is exercised locally
 * against a seeded database.
 */
export function orderingGateEnforced(): boolean {
  const flag = (process.env.MARKETPLACE_ORDERING_ENABLED ?? "").trim().toLowerCase();
  if (flag === "true") return true;
  if (flag === "false") return false;
  return process.env.NODE_ENV === "production";
}

/**
 * Customer-facing wording for a restaurant that cannot currently take orders.
 *
 * Shown in both places a customer can learn about it: the restaurant listing
 * page (which also hides the order path behind this banner) and the refusal from
 * `computeBill`. Both read this constant so the estimate and the order can never
 * disagree, and so the page cannot advertise an order button checkout is about
 * to reject.
 */
export const ORDERING_CLOSED_MESSAGE =
  "This restaurant is not accepting orders online right now";
