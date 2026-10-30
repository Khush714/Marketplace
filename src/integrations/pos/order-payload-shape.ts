/**
 * Pure shape rules for the Marketplace → POS order payload.
 *
 * No "server-only" here on purpose, matching `order-status.ts`: this module has
 * no env, no DB and no network, so the order bridge and test harnesses can both
 * import it. The rules below are a CONTRACT with the POS, and a contract that
 * cannot be imported outside Next.js cannot be regression-tested.
 */

import type { OrderItemSnapshot } from "@/db/schema";
import { isPaidStatus } from "@/lib/payment-security-core";

/**
 * Payment methods the POS books as SETTLED money. This must mirror the POS's own
 * `METHOD_OVERRIDE` (Restaurant AI `Backend/integrations/marketplace/payments.js:71`)
 * minus the cash/COD family: `upi, card, netbanking, wallet, emi, paylater` are all
 * captured online by the POS, and `emi`/`paylater` settle there as `card`.
 *
 * Anything outside this set rides as `payment_status: "COD"` so the POS records
 * `amount_paid = 0, balance_due = total` and the restaurant collects in person.
 * Keeping the two sets aligned is money-correctness, not cosmetics: a
 * `netbanking` / `wallet` / `emi` / `paylater` order left out of this set is
 * booked as an unpaid cash order even though the customer already paid, and the
 * restaurant asks for money that is not owed.
 */
const ONLINE_PAYMENT_METHODS: ReadonlySet<string> = new Set([
  "upi",
  "card",
  "netbanking",
  "wallet",
  "emi",
  "paylater",
]);

/** Does this payment method mean the money is already captured online? */
export function isOnlinePaymentMethod(method: string | null | undefined): boolean {
  if (!method) return false;
  return ONLINE_PAYMENT_METHODS.has(String(method).trim().toLowerCase());
}

/**
 * Whether an order is cleared to be handed to the POS.
 *
 * An online order is only processed once the money is actually captured. The
 * payload labels every online order `PAID`, so delivering one before capture
 * would tell the restaurant it was paid when it was not, and would put food in
 * the kitchen for an order nobody paid for. COD/cash are collect-in-person and
 * are always cleared (the POS books them `amount_paid = 0`).
 *
 * This is the fail-closed gate both the delivery journal (enqueue) and the
 * send path consult, so no unpaid online order can be processed at all.
 */
export function isClearedForPos(order: { paymentMethod: string; paymentStatus: string }): boolean {
  return !isOnlinePaymentMethod(order.paymentMethod) || isPaidStatus(order.paymentStatus);
}

/**
 * The POS persists exactly three fields per order line — `name`, `quantity` and
 * `unit_price` (Restaurant AI `Backend/integrations/marketplace/orders.js:543-547`)
 * — and has no modifier columns at all. A sibling `modifiers` array is therefore
 * dropped on ingest, leaving the kitchen ticket showing a bare item name that
 * does not say what was actually ordered, and a receipt charging one inflated
 * unit price with no explanation. Folding the selection into `name` is what makes
 * the ticket correct, and it needs no change to the POS order schema.
 *
 * Repeated modifiers are prefixed with their count ("2x Extra Cheese") so a
 * doubled option is not silently printed once.
 */
export function posItemName(item: Pick<OrderItemSnapshot, "name" | "modifiers">): string {
  const mods = (item.modifiers ?? []).filter((m) => m && m.name);
  if (mods.length === 0) return item.name;
  const summary = mods
    .map((m) => (m.quantity > 1 ? `${m.quantity}x ${m.name}` : m.name))
    .join(", ");
  return `${item.name} (${summary})`;
}
