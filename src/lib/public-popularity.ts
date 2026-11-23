import { validateImageUrl } from "@/lib/image-policy";
import type { PopularDishDto, PublicPopularityDto } from "@/lib/types";

/**
 * Phase 5 popularity policy, kept free of `server-only` so the rules can be
 * unit-tested and the SQL query can import the exact same constants.
 *
 * The only signal is first-party order data. A dish has to be bought in enough
 * distinct orders before it is called trending; units alone would let one bulk
 * order outrank a room full of customers, and device-local recents or manual
 * `is_bestseller` flags are not order signals at all.
 */

/** Rolling window used by the public query. */
export const POPULARITY_WINDOW_DAYS = 30;
/** Distinct fulfilled orders a dish needs before any scope may show it. */
export const POPULARITY_MIN_DISH_ORDERS = 3;
export const POPULARITY_LIMIT = 8;
/** SQL-side cap before locality selection and name de-duplication. */
export const POPULARITY_AGGREGATE_LIMIT = 100;

export const POPULARITY_FULFILLED_STATUSES = ["DELIVERED", "COMPLETED"] as const;
export const POPULARITY_EXCLUDED_ORDER_STATUSES = ["CANCELLED", "REJECTED"] as const;
export const POPULARITY_PAID_PAYMENT_STATUS = "PAID";
export const POPULARITY_COD_PAYMENT_METHODS = ["cod", "cash"] as const;
export const POPULARITY_EXCLUDED_PAYMENT_STATUSES = [
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "REFUND_PENDING",
  "FAILED",
  "PAYMENT_CANCELLED",
] as const;

export interface PopularityOrderSnapshot {
  paymentStatus: string;
  paymentMethod: string;
  merchantManaged: boolean;
  merchantStatus: string;
  posConnected: boolean;
  integrationStatus: string;
  posDeliveryStatus?: string;
}

function includes(values: readonly string[], value: string): boolean {
  return values.includes(value);
}

/**
 * The JS mirror of the SQL eligibility predicate. Both lifecycles count:
 * Merchant App orders and POS-admitted marketplace orders are equally real
 * first-party purchases. Cancellations, rejections, failures and refunds never
 * count, and COD counts only once the kitchen has actually fulfilled it.
 */
export function isEligiblePopularityOrder(order: PopularityOrderSnapshot): boolean {
  const paymentStatus = order.paymentStatus.trim().toUpperCase();
  const paymentMethod = order.paymentMethod.trim().toLowerCase();
  const merchantStatus = order.merchantStatus.trim().toUpperCase();
  const integrationStatus = order.integrationStatus.trim().toUpperCase();
  const posDeliveryStatus = (order.posDeliveryStatus ?? "").trim().toUpperCase();

  if (includes(POPULARITY_EXCLUDED_PAYMENT_STATUSES, paymentStatus)) return false;
  if (posDeliveryStatus === "FAILED") return false;
  if (
    includes(POPULARITY_EXCLUDED_ORDER_STATUSES, merchantStatus) ||
    includes(POPULARITY_EXCLUDED_ORDER_STATUSES, integrationStatus)
  ) {
    return false;
  }

  const paid =
    paymentStatus === POPULARITY_PAID_PAYMENT_STATUS ||
    includes(POPULARITY_COD_PAYMENT_METHODS, paymentMethod);
  if (!paid) return false;

  return (
    (order.merchantManaged && includes(POPULARITY_FULFILLED_STATUSES, merchantStatus)) ||
    (order.posConnected && includes(POPULARITY_FULFILLED_STATUSES, integrationStatus))
  );
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : null;
}

function cleanPositive(value: unknown): number | null {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(n) || n <= 0 || n > Number.MAX_SAFE_INTEGER) return null;
  return n;
}

function cleanPrice(value: unknown): number | null {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) return null;
  return Math.floor(n);
}

/** Re-validate aggregate rows: they arrive from PostgreSQL as strings. */
export function normalizePopularityRow(value: unknown): PopularDishDto | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = cleanPositive(raw.id);
  const orderCount = cleanPositive(raw.orderCount);
  const unitsSold = cleanPositive(raw.unitsSold);
  const priceCents = cleanPrice(raw.priceCents);
  const imageUrl = validateImageUrl(raw.imageUrl);
  const name = cleanText(raw.name, 160);
  const restaurantSlug = cleanText(raw.restaurantSlug, 200);
  const restaurantName = cleanText(raw.restaurantName, 160);
  const locality = cleanText(raw.locality, 80);
  if (
    id === null ||
    orderCount === null ||
    unitsSold === null ||
    priceCents === null ||
    !imageUrl ||
    !name ||
    !restaurantSlug ||
    !restaurantName ||
    !locality
  ) {
    return null;
  }
  return {
    id,
    name,
    imageUrl,
    priceCents,
    isVeg: raw.isVeg === true,
    restaurantSlug,
    restaurantName,
    locality,
    orderCount,
    unitsSold,
  };
}

function preferred(left: PopularDishDto, right: PopularDishDto): boolean {
  if (left.orderCount !== right.orderCount) return left.orderCount > right.orderCount;
  if (left.unitsSold !== right.unitsSold) return left.unitsSold > right.unitsSold;
  const byRestaurant = left.restaurantName.localeCompare(right.restaurantName);
  if (byRestaurant !== 0) return byRestaurant < 0;
  return left.id < right.id;
}

/**
 * The same dish can be sold by several kitchens. Chips and cards must not show
 * five copies of "Paneer Tikka", so orders are summed by dish name and one
 * representative kitchen (the strongest seller) carries the deep link.
 */
export function aggregatePopularityRows(rows: readonly unknown[]): PopularDishDto[] {
  const groups = new Map<string, { orders: number; units: number; best: PopularDishDto }>();
  for (const candidate of rows) {
    const row = normalizePopularityRow(candidate);
    if (!row) continue;
    const key = row.name.toLocaleLowerCase("en-IN");
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { orders: row.orderCount, units: row.unitsSold, best: row });
      continue;
    }
    existing.orders += row.orderCount;
    existing.units += row.unitsSold;
    if (preferred(row, existing.best)) existing.best = row;
  }
  return [...groups.values()].map(({ orders, units, best }) => ({
    ...best,
    orderCount: orders,
    unitsSold: units,
  }));
}

/** Distinct orders first, units second, stable alphabetical tie-breaker last. */
export function rankPopularityRows(rows: readonly unknown[], limit = POPULARITY_LIMIT): PopularDishDto[] {
  return aggregatePopularityRows(rows)
    .sort(
      (a, b) =>
        b.orderCount - a.orderCount ||
        b.unitsSold - a.unitsSold ||
        a.name.localeCompare(b.name) ||
        a.id - b.id,
    )
    .slice(0, limit);
}

export interface PopularitySelectionOptions {
  locality: string;
  city: string;
  cityLocalities: readonly string[];
  limit?: number;
}

function payload(
  options: PopularitySelectionOptions,
  scope: PublicPopularityDto["scope"],
  scopeLabel: string,
  dishes: PopularDishDto[],
): PublicPopularityDto {
  return {
    locality: options.locality,
    city: options.city,
    scope,
    scopeLabel: scope === "none" ? "" : scopeLabel,
    windowDays: POPULARITY_WINDOW_DAYS,
    minimumOrders: POPULARITY_MIN_DISH_ORDERS,
    dishes,
  };
}

function qualifying(dishes: readonly PopularDishDto[]): PopularDishDto[] {
  // The sample floor applies to every rendered chip/card, not just the first
  // one. A strong leader must not drag below-threshold dishes onto the rail.
  return dishes.filter((dish) => dish.orderCount >= POPULARITY_MIN_DISH_ORDERS);
}

function hasSignal(dishes: readonly PopularDishDto[]): boolean {
  return dishes.length > 0;
}

/**
 * Locality first, then the rest of the city, then nothing.
 *
 * City fallback is still scoped to the known Bharuch localities, so a stray row
 * from another city can never be presented as "Trending in Bharuch". When even
 * the city cannot clear the minimum, callers get an empty result rather than an
 * invented trend.
 */
export function selectPublicPopularity(
  rows: readonly unknown[],
  options: PopularitySelectionOptions,
): PublicPopularityDto {
  const clean = rows.map(normalizePopularityRow).filter((row): row is PopularDishDto => row !== null);
  const limit = options.limit ?? POPULARITY_LIMIT;

  const local = qualifying(
    rankPopularityRows(
      clean.filter((row) => row.locality === options.locality),
      limit,
    ),
  );
  if (hasSignal(local)) return payload(options, "locality", options.locality, local);

  const cityLocalities = new Set(options.cityLocalities);
  const citywide = qualifying(
    rankPopularityRows(
      clean.filter((row) => cityLocalities.has(row.locality)),
      limit,
    ),
  );
  if (hasSignal(citywide)) return payload(options, "city", options.city, citywide);

  return payload(options, "none", "", []);
}
