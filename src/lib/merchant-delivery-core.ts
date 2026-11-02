export const MERCHANT_DELIVERY_MODES = ["in_house", "rapido", "third_party"] as const;

export type MerchantDeliveryMode = (typeof MERCHANT_DELIVERY_MODES)[number];

export function isMerchantDeliveryMode(value: unknown): value is MerchantDeliveryMode {
  return MERCHANT_DELIVERY_MODES.some((mode) => mode === value);
}

export const MERCHANT_DELIVERY_STATUSES = [
  "pending",
  "assigned",
  "picked_up",
  "delivered",
] as const;

export type MerchantDeliveryStatus = (typeof MERCHANT_DELIVERY_STATUSES)[number];

export function isMerchantDeliveryStatus(value: unknown): value is MerchantDeliveryStatus {
  return MERCHANT_DELIVERY_STATUSES.some((status) => status === value);
}

const DELIVERY_TRANSITIONS: Record<MerchantDeliveryStatus, readonly MerchantDeliveryStatus[]> = {
  pending: ["assigned"],
  assigned: ["assigned", "picked_up"],
  picked_up: ["delivered"],
  delivered: [],
};

export function canTransitionMerchantDelivery(
  current: MerchantDeliveryStatus,
  next: MerchantDeliveryStatus,
): boolean {
  return DELIVERY_TRANSITIONS[current].includes(next);
}
