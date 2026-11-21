/**
 * What "can this restaurant actually take an order" means, as one pure function.
 *
 * This started as a boolean buried in `hasActiveIntegration` and was duplicated
 * as a string-returning `notReadyReason` in the order and payment bridges, then
 * a third time as hard-coded "ACTIVE" in the partner UI. Four copies of one rule
 * is four chances to disagree, and they already did: the claim flow can set
 * `status = 'active'` without sealing a webhook secret (it only seals one when
 * the POS actually sends it), so a record could look ACTIVE while delivery
 * refused to POST. That is the stuck-`PAYMENT_PENDING` bug.
 *
 * One rule, one place. `hasActiveIntegration` (order acceptance),
 * `resolveOutletForRestaurant` (outlet routing), both delivery bridges, and the
 * partner console all resolve through this, so the UI cannot tell a restaurant
 * it is live while checkout refuses the order.
 *
 * The three facts are exactly what a POST to the POS needs:
 *   - an ACTIVE integration record
 *   - a POS restaurant id to route `order.restaurant_id` on
 *   - a sealed webhook secret to sign the payload with
 */
export type IntegrationNotReadyReason =
  | "inactive"
  | "pos_restaurant_id"
  | "webhook_secret";

export interface IntegrationReadinessInput {
  /** `null` means no integration row exists at all. */
  status?: string | null;
  posRestaurantId?: string | null;
  webhookSecret?: string | null;
}

export interface IntegrationReadiness {
  ready: boolean;
  notReadyReason: IntegrationNotReadyReason | null;
}

export function integrationReadiness(
  rec: IntegrationReadinessInput,
): IntegrationReadiness {
  if (!rec || rec.status !== "active") {
    return { ready: false, notReadyReason: "inactive" };
  }
  if (!rec.posRestaurantId) {
    return { ready: false, notReadyReason: "pos_restaurant_id" };
  }
  if (!rec.webhookSecret) {
    return { ready: false, notReadyReason: "webhook_secret" };
  }
  return { ready: true, notReadyReason: null };
}

/** Narrowing for the common "can I accept this order at all?" question. */
export function canDeliverToPos(rec: IntegrationReadinessInput): boolean {
  return integrationReadiness(rec).ready;
}