import { isWithinMerchantHours } from "@/lib/merchant-hours";
import { isRestaurantClosed, type ClosureAwareRestaurant } from "@/lib/restaurant-closure";

/**
 * Server-side view of the two availability facts a listing card may state.
 *
 * The SQL browse filters and checkout already enforce these rules; this pure
 * helper lets `RestaurantDto` report the same decision without the browser
 * guessing from a local clock. Delivery here is the Merchant App's published
 * toggle, not a promise that a POS or payment integration can accept an order.
 */
export type ListingAvailabilityInput = ClosureAwareRestaurant & {
  merchantHoursEnabled: boolean;
  merchantOpensAt: string;
  merchantClosesAt: string;
  merchantDeliveryEnabled: boolean;
};

export type ListingAvailability = {
  openNow: boolean;
  deliveryAvailable: boolean;
};

export function listingAvailability(
  restaurant: ListingAvailabilityInput,
  now: Date = new Date(),
): ListingAvailability {
  const openNow =
    !isRestaurantClosed(restaurant, now) &&
    isWithinMerchantHours(
      restaurant.merchantHoursEnabled,
      restaurant.merchantOpensAt,
      restaurant.merchantClosesAt,
      now,
    );

  return {
    openNow,
    deliveryAvailable: openNow && restaurant.merchantDeliveryEnabled,
  };
}
