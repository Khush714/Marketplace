import "server-only";

/**
 * Whether checkout requires a live POS connection.
 *
 * The Marketplace can only ever fulfil an order by handing it to a
 * restaurant's POS. A restaurant with no ACTIVE integration record can never
 * receive one — the delivery journal deliberately skips those restaurants
 * (`enqueueOrderDelivery` returns null before creating a row), so the order
 * would be accepted, charged, and then sit at PLACED forever with nothing
 * behind it and no failure ever recorded. Admitting that order is strictly
 * worse than refusing it, so production fails CLOSED.
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
