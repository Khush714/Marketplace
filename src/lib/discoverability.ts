import "server-only";
import { sql } from "drizzle-orm";
import { menuItems, restaurants } from "@/db/schema";

/**
 * The one definition of "may this listing occupy a marketplace surface".
 *
 * Before this predicate every consumer reinvented the test: browse checked
 * `is_active`, the featured rail checked `is_active AND featured`, search
 * checked `is_active`, and none of them accounted for a restaurant with no
 * menu at all. The result was that a brand-new partner's empty listing
 * occupied a browse slot and the highest-value home-page rail the moment it
 * was onboarded, while a real customer landing on it saw a page that could not
 * fulfil anything.
 *
 * A listing is discoverable when it is ACTIVE and has at least one available
 * dish. That is the honest floor for a marketplace: no menu means the kitchen
 * cannot sell anything, so marketing surfaces are wasted on it. It is a floor
 * only — discoverable is NOT the same as orderable. A POS-less restaurant
 * still belongs on the browse grid (customers browse what exists near them);
 * the CHECKOUT gate (`orderingGateEnforced` + an ACTIVE integration record)
 * decides whether it can actually take money. An empty-menu restaurant remains
 * reachable by direct link on purpose: the listing page renders the "Menu
 * being prepared" state instead of a broken grid, so partners can eyeball
 * their page long before it earns a browse slot.
 *
 * Kept as a SQL fragment (not a JS predicate) so every query shares one
 * source of truth instead of drifting DTO copies.
 */
export const discoverableRestaurant = sql`
  ${restaurants.isActive} = true
  AND EXISTS (
    SELECT 1 FROM ${menuItems} mi
    WHERE mi.restaurant_id = ${restaurants.id}
      AND mi.available = true
  )
`;