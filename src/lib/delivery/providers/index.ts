import type { DeliveryProvider, DeliveryProviderId } from "./types";
import { InternalDeliveryProvider } from "./internal";
import { ProviderADeliveryProvider } from "./provider-a";
import { ProviderBDeliveryProvider } from "./provider-b";

export * from "./types";

/** PHASE 12 — the fleet registry. The rest of the app only ever asks for a
 * provider by id; it never touches a concrete fleet. */
const registry: Record<DeliveryProviderId, DeliveryProvider> = {
  internal: InternalDeliveryProvider,
  "provider-a": ProviderADeliveryProvider,
  "provider-b": ProviderBDeliveryProvider,
};

/** Third-party fleet used when a restaurant has no in-house rider. */
export const DEFAULT_EXTERNAL_PROVIDER: DeliveryProviderId = "provider-a";

export function getDeliveryProvider(
  id: DeliveryProviderId = DEFAULT_EXTERNAL_PROVIDER,
): DeliveryProvider {
  return registry[id] ?? registry[DEFAULT_EXTERNAL_PROVIDER];
}