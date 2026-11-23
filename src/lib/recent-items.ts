import { validateImageUrl } from "@/lib/image-policy";
import type {
  DishSearchResult,
  RestaurantDto,
  RestaurantSearchResult,
} from "@/lib/types";

/**
 * Device-local recents kept alongside favourites and raw search terms.
 *
 * These records are written into the single profile localStorage blob, which is
 * user-writable, so every field is re-validated on hydration. A hand-edited
 * record must not be able to put an arbitrary string into `next/image` or a
 * bogus key into the recents list.
 */
export const RECENT_ITEMS_LIMIT = 6;

export interface RecentDish {
  id: number;
  name: string;
  imageUrl: string;
  restaurantSlug: string;
  restaurantName: string;
  priceCents: number;
  isVeg: boolean;
}

export interface RecentRestaurant {
  slug: string;
  name: string;
  imageUrl: string;
  cuisines: string[];
  rating: number;
  ratingsCount: number;
  deliveryMinutes: number;
}

function readText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  if (!clean) return null;
  return clean.slice(0, maxLength);
}

function readNumber(value: unknown, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) return null;
  return value;
}

function readImageUrl(value: unknown): string | null {
  // Reuse the same policy the DTO mappers use. A tampered profile record must
  // not be able to point the image optimiser at an arbitrary host.
  return validateImageUrl(typeof value === "string" ? value.slice(0, 2000) : value);
}

export function normalizeRecentDish(value: unknown): RecentDish | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = readNumber(raw.id, Number.MAX_SAFE_INTEGER);
  if (id === null || !Number.isInteger(id) || id <= 0) return null;
  const name = readText(raw.name, 160);
  const imageUrl = readImageUrl(raw.imageUrl);
  const restaurantSlug = readText(raw.restaurantSlug, 200);
  const restaurantName = readText(raw.restaurantName, 160);
  const priceCents = readNumber(raw.priceCents, Number.MAX_SAFE_INTEGER);
  if (!name || !imageUrl || !restaurantSlug || !restaurantName || priceCents === null) return null;
  return {
    id,
    name,
    imageUrl,
    restaurantSlug,
    restaurantName,
    priceCents,
    isVeg: raw.isVeg === true,
  };
}

export function normalizeRecentRestaurant(value: unknown): RecentRestaurant | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const slug = readText(raw.slug, 200);
  const name = readText(raw.name, 160);
  const imageUrl = readImageUrl(raw.imageUrl);
  const rating = readNumber(raw.rating, 5);
  const ratingsCount = readNumber(raw.ratingsCount, Number.MAX_SAFE_INTEGER);
  const deliveryMinutes = readNumber(raw.deliveryMinutes, 24 * 60);
  if (!slug || !name || !imageUrl || rating === null || ratingsCount === null || deliveryMinutes === null) {
    return null;
  }
  const cuisines = Array.isArray(raw.cuisines)
    ? raw.cuisines
        .map((c) => readText(c, 80))
        .filter((c): c is string => Boolean(c))
        .slice(0, 8)
    : [];
  return { slug, name, imageUrl, cuisines, rating, ratingsCount, deliveryMinutes };
}

function dishKey(dish: RecentDish): string {
  return `${dish.id}:${dish.restaurantSlug}`;
}

export function upsertRecentDish(list: readonly RecentDish[], dish: RecentDish): RecentDish[] {
  const clean = normalizeRecentDish(dish);
  if (!clean) return [...list].slice(0, RECENT_ITEMS_LIMIT);
  const key = dishKey(clean);
  return [clean, ...list.filter((item) => dishKey(item) !== key)].slice(0, RECENT_ITEMS_LIMIT);
}

export function upsertRecentRestaurant(
  list: readonly RecentRestaurant[],
  restaurant: RecentRestaurant,
): RecentRestaurant[] {
  const clean = normalizeRecentRestaurant(restaurant);
  if (!clean) return [...list].slice(0, RECENT_ITEMS_LIMIT);
  return [clean, ...list.filter((item) => item.slug !== clean.slug)].slice(0, RECENT_ITEMS_LIMIT);
}

export function recentDishFromSearch(dish: DishSearchResult): RecentDish {
  return {
    id: dish.id,
    name: dish.name,
    imageUrl: dish.imageUrl,
    restaurantSlug: dish.restaurantSlug,
    restaurantName: dish.restaurantName,
    priceCents: dish.priceCents,
    isVeg: dish.isVeg,
  };
}

export function recentRestaurantFromSearch(restaurant: RestaurantSearchResult): RecentRestaurant {
  return {
    slug: restaurant.slug,
    name: restaurant.name,
    imageUrl: restaurant.imageUrl,
    cuisines: restaurant.cuisines,
    rating: restaurant.rating,
    ratingsCount: restaurant.ratingsCount,
    deliveryMinutes: restaurant.deliveryMinutes,
  };
}

export function recentRestaurantFromDto(restaurant: RestaurantDto): RecentRestaurant {
  return {
    slug: restaurant.slug,
    name: restaurant.name,
    imageUrl: restaurant.imageUrl,
    cuisines: restaurant.cuisines,
    rating: restaurant.rating,
    ratingsCount: restaurant.ratingsCount,
    deliveryMinutes: restaurant.deliveryMinutes,
  };
}
