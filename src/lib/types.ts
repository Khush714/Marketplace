import type { OrderItemSnapshot } from "@/db/schema";

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
  distanceKm: number;
  offer: string | null;
  imageUrl: string;
  heroUrl: string;
  featured: boolean;
  pureVeg: boolean;
  locality: string;
  /** Canonical public Marketplace External Restaurant ID (rst_…). */
  marketplaceId: string | null;
}

export interface RestaurantManageDto extends RestaurantDto {
  isActive: boolean;
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
  /** Modifier groups offered for this dish. Absent when it has none. */
  modifierGroups?: ModifierGroupDto[];
}

/* ------------------------- partner menu editor (P0) ------------------------ */

export interface PartnerMenuItemDto {
  id: number;
  category: string;
  name: string;
  description: string;
  priceCents: number;
  imageUrl: string;
  isVeg: boolean;
  isBestseller: boolean;
  available: boolean;
  sort: number;
  /** Modifier group ids currently attached to this dish. */
  modifierGroupIds: number[];
  /** True when the row is POS-owned, so the editor must not offer destructive edits. */
  posSynced: boolean;
}

export interface PartnerModifierOptionDto {
  id: number;
  name: string;
  priceCents: number;
  isVeg: boolean;
  available: boolean;
  posSynced: boolean;
}

export interface PartnerModifierGroupDto {
  id: number;
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
  instructions: string;
  riderName: string;
  subtotalCents: number;
  deliveryFeeCents: number;
  platformFeeCents: number;
  discountCents: number;
  totalCents: number;
  createdAt: string;
  status: OrderStatusDto;
}

export interface ConnectionCodeDto {
  id: number;
  code: string;
  status: "unused" | "used";
  restaurantId: number | null;
  restaurantName: string | null;
  createdAt: string;
  usedAt: string | null;
  expiresAt: string | null;
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
}

export type SearchResult = RestaurantSearchResult | DishSearchResult;
