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
}

export interface MenuSection {
  category: string;
  items: MenuItemDto[];
}

export interface OrderStatusDto {
  stageIndex: number;
  stageKey: string;
  stageLabel: string;
  stageSub: string;
  delivered: boolean;
  riderProgress: number;
  etaIso: string;
  etaSeconds: number;
}

export interface OrderDto {
  id: number;
  code: string;
  restaurantSlug: string;
  restaurantName: string;
  items: OrderItemSnapshot[];
  addressLabel: string;
  addressText: string;
  customerName: string;
  phone: string;
  paymentMethod: string;
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

export interface RestaurantSearchResult {
  type: "restaurant";
  slug: string;
  name: string;
  cuisines: string[];
  rating: number;
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
