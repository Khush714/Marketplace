import type { OrderItemSnapshot } from "@/db/schema";
import type { FeedbackDto } from "@/lib/order-feedback";

/* Shared shapes used across server components, API routes and client UI. */

export interface RestaurantDto {
  id: number;
  slug: string;
  name: string;
  tagline: string;
  cuisines: string[];
  rating: number;
  ratingsCount: number;
  priceLevel: number;
  deliveryMinutes: number;
  /** Null when the platform has not measured this — render "Nearby", never a guess. */
  distanceKm: number | null;
  offer: string | null;
  imageUrl: string;
  heroUrl: string;
  featured: boolean;
  pureVeg: boolean;
  locality: string;
  /** Published hours and closure state, evaluated on the server's clock. */
  openNow: boolean;
  /** Merchant App delivery toggle while open; not a checkout/POS readiness claim. */
  deliveryAvailable: boolean;
  /** Canonical public Marketplace External Restaurant ID (rst_…). */
  marketplaceId: string | null;
}

export interface RestaurantManageDto extends RestaurantDto {
  isActive: boolean;
  merchantHoursEnabled: boolean;
  merchantOpensAt: string;
  merchantClosesAt: string;
  merchantPickupEnabled: boolean;
  merchantDeliveryEnabled: boolean;
  closureReason: string;
  closureUntil: string | null;
  scheduledLeaves: { date: string; reason: string }[];
}

export interface ModifierOptionDto {
  id: number;
  name: string;
  priceCents: number;
  isVeg: boolean;
}

export interface ModifierGroupDto {
  id: number;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: ModifierOptionDto[];
}

export interface MenuItemDto {
  id: number;
  restaurantId: number;
  category: string;
  name: string;
  description: string;
  priceCents: number;
  imageUrl: string;
  isVeg: boolean;
  isBestseller: boolean;
  /** The menu row's real availability flag; false means stop offering this dish. */
  available: boolean;
  /** Null means stock is not tracked; zero is sold out at checkout. */
  stockQuantity: number | null;
  /** Modifier groups offered for this dish. Absent when it has none. */
  modifierGroups?: ModifierGroupDto[];
}

/* ------------------------- partner menu editor (P0) ------------------------ */

export interface PartnerMenuItemDto {
  id: number;
  /** Stable key supplied by the paired Merchant App; absent on POS/manual rows. */
  externalId?: string;
  category: string;
  name: string;
  description: string;
  priceCents: number;
  imageUrl: string;
  isVeg: boolean;
  /** Exact Merchant CSV dietary value; older rows infer it from isVeg. */
  dietary?: "veg" | "nonveg" | "unspecified";
  /** Soft-deleted by a full menu replacement; never hard-deleted. */
  archived?: boolean;
  isBestseller: boolean;
  available: boolean;
  /** Null means stock is not tracked; zero is sold out at checkout. */
  stockQuantity: number | null;
  sort: number;
  /** Modifier group ids currently attached to this dish. */
  modifierGroupIds: number[];
  /** True when the row is POS-owned, so the editor must not offer destructive edits. */
  posSynced: boolean;
}

export interface PartnerModifierOptionDto {
  id: number;
  /** Stable key supplied by the paired Merchant App; absent on POS/manual rows. */
  externalId?: string;
  name: string;
  priceCents: number;
  isVeg: boolean;
  available: boolean;
  posSynced: boolean;
}

export interface PartnerModifierGroupDto {
  id: number;
  /** Stable key supplied by the paired Merchant App; absent on POS/manual rows. */
  externalId?: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  isActive: boolean;
  options: PartnerModifierOptionDto[];
  /** How many of the owner's dishes currently offer this group. */
  itemCount: number;
  posSynced: boolean;
}

export interface PartnerMenuDto {
  restaurant: {
    id: number;
    name: string;
    slug: string;
    isActive: boolean;
    /** Set when a POS owns this menu; the editor still works, rows coexist. */
    posConnected: boolean;
  };
  items: PartnerMenuItemDto[];
  modifierGroups: PartnerModifierGroupDto[];
}

export interface MenuSection {
  category: string;
  items: MenuItemDto[];
}

export interface OrderLifecycleStage {
  stageIndex: number;
  stageKey: string;
  stageLabel: string;
  stageSub: string;
  delivered: boolean;
  riderProgress: number;
}

export interface OrderStatusDto extends OrderLifecycleStage {
  etaIso: string;
  etaSeconds: number;
  statusUpdatedAt: string | null;
  stages: OrderLifecycleStage[];
  cancellable: boolean;
  cancelReason: string | null;
}

export interface OrderDto {
  id: number;
  code: string;
  restaurantSlug: string;
  restaurantName: string;
  /** Public neighbourhood, shown when a customer collects an order in store. */
  restaurantLocality: string;
  /**
   * How the customer receives this order. Merchant-managed orders can be
   * switched by the restaurant; every other order keeps the delivery timeline.
   */
  fulfilment: "pickup" | "delivery";
  /** Internal ids — never surfaced in the customer tracking payload. */
  restaurantId: number;
  externalOrderId: string | null;
  items: OrderItemSnapshot[];
  addressLabel: string;
  addressText: string;
  customerName: string;
  phone: string;
  paymentMethod: string;
  paymentStatus: string;
  /**
   * Snapshot of the Marketplace -> POS delivery journal: PENDING → DELIVERED |
   * FAILED. FAILED means the order never reached the kitchen, which for a
   * captured payment means the customer is owed a refund — the tracking view
   * must be able to say so rather than showing a stalled courier.
   */
  posDeliveryStatus: string;
  /** Whether this order was admitted while the restaurant had a live POS. */
  posConnected: boolean;
  instructions: string;
  riderName: string;
  subtotalCents: number;
  deliveryFeeCents: number;
  platformFeeCents: number;
  discountCents: number;
  /** Customer-selected gratuity in integer paise, already included in totalCents. */
  tipCents: number;
  totalCents: number;
  /** ISO timestamp for a pre-ordered slot; null for immediate orders. */
  scheduledFor: string | null;
  /** Uploaded review photo ids, in display order. */
  reviewPhotoIds: number[];
  /** Merchant App promo code used for this discount; null for legacy/no offer. */
  offerCode: string | null;
  /** One immutable customer review per delivered order; empty until submitted. */
  feedback: FeedbackDto;
  createdAt: string;
  status: OrderStatusDto;
}

export interface ConnectionCodeDto {
  id: number;
  code: string;
  /**
   * "revoked" is an operator withdrawing an unused invite, not a redemption.
   * It is a terminal state distinct from "used": "used" means a listing was
   * created from it, and the operator must never be able to put a code back
   * into circulation after that.
   */
  status: "unused" | "used" | "revoked";
  restaurantId: number | null;
  restaurantName: string | null;
  createdAt: string;
  usedAt: string | null;
  expiresAt: string | null;
  /** When an operator withdrew the code, or null if it was never revoked. */
  revokedAt: string | null;
}

export interface ConnectionDto {
  id: number;
  code: string;
  restaurantId: number;
  restaurantName: string;
  restaurantSlug: string;
  marketplace: string;
  status: string;
  connectedAt: string;
}

export type SearchMatchKind = "name" | "category" | "description" | "cuisine" | "tagline";

export interface RestaurantSearchResult {
  type: "restaurant";
  slug: string;
  name: string;
  cuisines: string[];
  rating: number;
  /** Drives the "New" pill — a search hit must not show a score it never earned. */
  ratingsCount: number;
  deliveryMinutes: number;
  imageUrl: string;
  offer: string | null;
  /** Which field earned the hit, so card copy never implies a dish match. */
  match: SearchMatchKind;
}

export interface DishSearchResult {
  type: "dish";
  id: number;
  name: string;
  priceCents: number;
  isVeg: boolean;
  imageUrl: string;
  restaurantSlug: string;
  restaurantName: string;
  /** Which field earned the hit — category matches still sell a real dish. */
  match: SearchMatchKind;
}

export type SearchResult = RestaurantSearchResult | DishSearchResult;

export type SearchSuggestionKind = "dish" | "cuisine" | "category" | "restaurant";

/**
 * A compact query refinement, not a second copy of a result card. Tapping a
 * dish/cuisine/category suggestion runs a broader search for that term; tapping
 * a restaurant suggestion opens the listing directly.
 */
export interface SearchSuggestion {
  kind: SearchSuggestionKind;
  text: string;
  /** Only present for a restaurant suggestion. */
  restaurantSlug?: string;
  /** Only present for a dish suggestion that can deep-link to a menu item. */
  dishId?: number;
}

export interface SearchFacets {
  cuisines: string[];
  categories: string[];
}

/* ---------------------- phase 5: locality popularity ---------------------- */

/**
 * One dish at one kitchen, ranked from first-party order snapshots.
 *
 * `orderCount` is distinct fulfilled orders, not units: one customer ordering
 * ten plates must not outrank ten customers ordering one. The immutable order
 * snapshot supplies what was actually ordered; the live menu row supplies the
 * current image/price and the deep link.
 */
export interface PopularDishDto {
  id: number;
  name: string;
  imageUrl: string;
  priceCents: number;
  isVeg: boolean;
  restaurantSlug: string;
  restaurantName: string;
  locality: string;
  orderCount: number;
  unitsSold: number;
}

export type PopularityScope = "locality" | "city" | "none";

/**
 * Public popularity payload. `scope: "none"` is a real result: the UI hides the
 * section instead of inventing a trend from a handful of orders or localStorage
 * recents, neither of which is a reliable first-party signal.
 */
export interface PublicPopularityDto {
  locality: string;
  city: string;
  scope: PopularityScope;
  scopeLabel: string;
  windowDays: number;
  minimumOrders: number;
  dishes: PopularDishDto[];
}
