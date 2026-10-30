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
 * The facts required depend on the provider, because they follow from how the
 * outbound call authenticates:
 *
 *   - every provider: an ACTIVE integration record and a destination to send
 *     the order to;
 *   - Restaurant AI: a provider-side marketplace id plus a sealed webhook
 *     secret to sign the payload with;
 *   - Petpooja: its `restID` plus partner-level app credentials, read from the
 *     environment;
 *   - Custom webhook: a per-listing endpoint (`webhook_url`) plus a sealed
 *     per-listing signing secret. Both are supplied at ops onboarding, so
 *     there is no passkey or partner credential to wait for.
 *
 * The credential fact is INJECTED (`partnerCredentialsConfigured`) rather than
 * read here: this module is pure, and `node --test` imports it without an
 * environment. A caller that forgets to supply it fails closed.
 *
 * An unknown provider is never ready. It has no delivery adapter, so accepting
 * an order for it would charge a customer for food nothing can cook.
 */
export type IntegrationNotReadyReason =
  | "inactive"
  | "pos_restaurant_id"
  | "webhook_secret"
  | "webhook_url"
  | "provider_credentials"
  | "unsupported_provider";

export interface IntegrationReadinessInput {
  /** `null` means no integration row exists at all. */
  status?: string | null;
  /** Provider on the record; absent means the legacy Restaurant AI default. */
  provider?: string | null;
  posRestaurantId?: string | null;
  webhookSecret?: string | null;
  /** `custom_webhook` only: the per-listing outbound endpoint. */
  webhookUrl?: string | null;
  /** Whether the provider's partner-wide credentials are present. */
  partnerCredentialsConfigured?: boolean;
}

export interface IntegrationReadiness {
  ready: boolean;
  notReadyReason: IntegrationNotReadyReason | null;
}

/** The provider a record with no explicit value belongs to (legacy rows). */
export const DEFAULT_POS_PROVIDER = "restaurant-ai";

export function integrationReadiness(
  rec: IntegrationReadinessInput,
): IntegrationReadiness {
  if (!rec || rec.status !== "active") {
    return { ready: false, notReadyReason: "inactive" };
  }

  const provider = rec.provider ?? DEFAULT_POS_PROVIDER;

  if (provider === DEFAULT_POS_PROVIDER) {
    if (!rec.posRestaurantId) {
      return { ready: false, notReadyReason: "pos_restaurant_id" };
    }
    if (!rec.webhookSecret) {
      return { ready: false, notReadyReason: "webhook_secret" };
    }
    return { ready: true, notReadyReason: null };
  }

  if (provider === "petpooja") {
    if (!rec.posRestaurantId) {
      return { ready: false, notReadyReason: "pos_restaurant_id" };
    }
    if (!rec.partnerCredentialsConfigured) {
      return { ready: false, notReadyReason: "provider_credentials" };
    }
    return { ready: true, notReadyReason: null };
  }

  if (provider === "custom_webhook") {
    // The endpoint is the routing identity here, so there is no POS restaurant
    // id to demand. Both facts are provisioned by ops in the same call.
    if (!rec.webhookUrl) {
      return { ready: false, notReadyReason: "webhook_url" };
    }
    if (!rec.webhookSecret) {
      return { ready: false, notReadyReason: "webhook_secret" };
    }
    return { ready: true, notReadyReason: null };
  }

  return { ready: false, notReadyReason: "unsupported_provider" };
}

/** Narrowing for the common "can I accept this order at all?" question. */
export function canDeliverToPos(rec: IntegrationReadinessInput): boolean {
  return integrationReadiness(rec).ready;
}
