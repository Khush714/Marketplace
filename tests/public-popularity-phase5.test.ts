/**
 * Phase 5: locality-aware trending and popular dishes.
 *
 * Popularity is a first-party order claim, so the policy is tested directly and
 * the SQL/API/UI wiring is pinned from source. Nothing here may promote local
 * recents, manual bestseller flags or invented metrics into a trend.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  POPULARITY_COD_PAYMENT_METHODS,
  POPULARITY_EXCLUDED_PAYMENT_STATUSES,
  POPULARITY_FULFILLED_STATUSES,
  POPULARITY_LIMIT,
  POPULARITY_MIN_DISH_ORDERS,
  POPULARITY_WINDOW_DAYS,
  aggregatePopularityRows,
  isEligiblePopularityOrder,
  normalizePopularityRow,
  rankPopularityRows,
  selectPublicPopularity,
  type PopularityOrderSnapshot,
} from "@/lib/public-popularity";
import type { PopularDishDto } from "@/lib/types";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const IMAGE = "https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg";

function dish(overrides: Partial<PopularDishDto> = {}): PopularDishDto {
  return {
    id: 1,
    name: "Paneer Tikka",
    imageUrl: IMAGE,
    priceCents: 25_000,
    isVeg: true,
    restaurantSlug: "spice-hut",
    restaurantName: "Spice Hut",
    locality: "Old City",
    orderCount: 4,
    unitsSold: 5,
    ...overrides,
  };
}

function order(overrides: Partial<PopularityOrderSnapshot> = {}): PopularityOrderSnapshot {
  return {
    paymentStatus: "PAID",
    paymentMethod: "upi",
    merchantManaged: true,
    merchantStatus: "COMPLETED",
    posConnected: false,
    integrationStatus: "PLACED",
    posDeliveryStatus: "PENDING",
    ...overrides,
  };
}

const selection = {
  locality: "Old City",
  city: "Bharuch",
  cityLocalities: ["Old City", "Zadeshwar", "Maktampur"],
};

test("the policy is a 30-day, three-order distinct-order floor", () => {
  assert.equal(POPULARITY_WINDOW_DAYS, 30);
  assert.equal(POPULARITY_MIN_DISH_ORDERS, 3);
  assert.equal(POPULARITY_LIMIT, 8);
  assert.deepEqual([...POPULARITY_FULFILLED_STATUSES], ["DELIVERED", "COMPLETED"]);
  assert.ok(POPULARITY_COD_PAYMENT_METHODS.includes("cod"));
  assert.ok(POPULARITY_EXCLUDED_PAYMENT_STATUSES.includes("REFUNDED"));
});

test("only paid or COD, fulfilled first-party orders count", () => {
  assert.equal(isEligiblePopularityOrder(order()), true);
  assert.equal(
    isEligiblePopularityOrder(
      order({
        merchantManaged: false,
        merchantStatus: "PLACED",
        posConnected: true,
        integrationStatus: "DELIVERED",
        paymentMethod: "cod",
        paymentStatus: "UNPAID",
      }),
    ),
    true,
  );
  assert.equal(
    isEligiblePopularityOrder(order({ merchantStatus: "CANCELLED" })),
    false,
    "cancelled kitchen orders are not sales",
  );
  assert.equal(
    isEligiblePopularityOrder(order({ merchantStatus: "REJECTED" })),
    false,
    "rejected kitchen orders are not sales",
  );
  assert.equal(isEligiblePopularityOrder(order({ paymentStatus: "REFUNDED" })), false);
  assert.equal(isEligiblePopularityOrder(order({ paymentStatus: "PAYMENT_PENDING" })), false);
  assert.equal(
    isEligiblePopularityOrder(order({ posConnected: true, posDeliveryStatus: "FAILED" })),
    false,
    "a POS delivery failure never reached the kitchen",
  );
  assert.equal(
    isEligiblePopularityOrder(
      order({ merchantManaged: false, merchantStatus: "PLACED", integrationStatus: "PLACED", paymentStatus: "UNPAID" }),
    ),
    false,
    "seeded/demo orders must not invent a trend",
  );
});

test("aggregate rows re-validate counts and image URLs", () => {
  assert.deepEqual(normalizePopularityRow({ ...dish(), orderCount: "4", unitsSold: "5" }), dish());
  assert.equal(normalizePopularityRow({ ...dish(), id: 0 }), null);
  assert.equal(normalizePopularityRow({ ...dish(), orderCount: -1 }), null);
  assert.equal(normalizePopularityRow({ ...dish(), imageUrl: "javascript:alert(1)" }), null);
  assert.equal(normalizePopularityRow({ ...dish(), restaurantSlug: " " }), null);
});

test("ranking sums one dish across kitchens and prefers distinct orders over units", () => {
  const ranked = rankPopularityRows([
    dish({ id: 1, orderCount: 4, unitsSold: 5 }),
    dish({ id: 2, restaurantSlug: "curry-house", restaurantName: "Curry House", orderCount: 3, unitsSold: 9 }),
    dish({ id: 3, name: "Biryani", orderCount: 3, unitsSold: 3 }),
    dish({ id: 4, name: "Dosa", orderCount: 2, unitsSold: 20 }),
    dish({ id: 5, name: "Unsafe", imageUrl: "http://127.0.0.1/x.jpg", orderCount: 99 }),
  ]);
  assert.deepEqual(
    ranked.map((d) => [d.name, d.orderCount, d.unitsSold, d.id]),
    [
      ["Paneer Tikka", 7, 14, 1],
      ["Biryani", 3, 3, 3],
      ["Dosa", 2, 20, 4],
    ],
  );
  // The representative deep-link belongs to the strongest eligible kitchen.
  assert.equal(ranked[0].restaurantSlug, "spice-hut");
  assert.equal(aggregatePopularityRows([]).length, 0);
});

test("scope falls back from locality to city, then hides thin data entirely", () => {
  const local = selectPublicPopularity(
    [dish({ id: 1, orderCount: POPULARITY_MIN_DISH_ORDERS })],
    selection,
  );
  assert.equal(local.scope, "locality");
  assert.equal(local.scopeLabel, "Old City");

  const city = selectPublicPopularity(
    [
      dish({ id: 1, orderCount: 2 }),
      dish({ id: 2, name: "Biryani", locality: "Zadeshwar", orderCount: 4 }),
      dish({ id: 3, name: "Out of city", locality: "Surat", orderCount: 50 }),
    ],
    selection,
  );
  assert.equal(city.scope, "city");
  assert.equal(city.scopeLabel, "Bharuch");
  assert.deepEqual(city.dishes.map((d) => d.name), ["Biryani"]);
  assert.ok(city.dishes.every((d) => d.orderCount >= POPULARITY_MIN_DISH_ORDERS));

  const none = selectPublicPopularity([dish({ id: 1, orderCount: 2 })], selection);
  assert.equal(none.scope, "none");
  assert.equal(none.scopeLabel, "");
  assert.deepEqual(none.dishes, []);
});

test("the public query uses the first-party order window, statuses and discoverability", () => {
  const query = compact(source("src/db/public-popularity.ts"));
  assert.match(query, /o\.created_at >= now\(\) - \(\$\{POPULARITY_WINDOW_DAYS\}/);
  assert.match(query, /o\.merchant_managed = true AND upper\(o\.merchant_status\) in \(\$\{fulfilled\}\)/);
  assert.match(query, /o\.pos_connected = true AND upper\(o\.integration_status\) in \(\$\{fulfilled\}\)/);
  assert.match(query, /upper\(o\.merchant_status\) not in \(\$\{excludedStatuses\}\)/);
  assert.match(query, /upper\(o\.payment_status\) = \$\{POPULARITY_PAID_PAYMENT_STATUS\}/);
  assert.match(query, /lower\(coalesce\(o\.payment_method, ''\)\) in \(\$\{codMethods\}\)/);
  assert.match(query, /upper\(o\.payment_status\) not in \(\$\{excludedPayments\}\)/);
  assert.match(query, /upper\(coalesce\(o\.pos_delivery_status, 'PENDING'\)\) <> 'FAILED'/);
  assert.match(query, /discoverableRestaurant/);
  assert.match(query, /eq\(menuItems\.available, true\)/);
  assert.match(query, /inArray\(restaurants\.locality, cityLocalities\)/);
  assert.match(query, /count\(distinct recent_order_items\.order_id\)/);
  assert.doesNotMatch(query, /getMerchantItemAnalytics|merchant-item-analytics/);
  assert.doesNotMatch(query, /recentDishes|recentSearches|isBestseller/);
});

test("the public API is guarded, locality-aware and edge-cached", () => {
  const route = source("src/app/api/popularity/route.ts");
  assert.match(route, /guardRead\(req, "popularity"\)/);
  assert.match(route, /revalidate = 60/);
  assert.match(route, /Cache-Control": "public, s-maxage=60/);
  assert.match(route, /localityByKey\(req\.nextUrl\.searchParams\.get\("loc"\)\)/);
  assert.match(route, /getPublicPopularity\(locality\)/);
});

test("home shows a real popularity rail and stops calling distance a popularity sort", () => {
  const home = compact(source("src/app/page.tsx"));
  assert.match(home, /getPublicPopularity\(locality\)/);
  assert.match(home, /popularity\.dishes\.length > 0/);
  assert.match(home, /Popular dishes near \$\{popularity\.scopeLabel\}/);
  assert.match(home, /Trending from \$\{popularityOrders\} real orders/);
  assert.match(home, /<Rail ariaLabel="Popular dishes">/);
  assert.match(home, /<PopularDishCard/);
  assert.match(home, /Restaurants near you/);
  assert.doesNotMatch(home, /title="Popular near you"/);

  const hero = source("src/components/home-hero.tsx");
  assert.doesNotMatch(hero, /Popular near you/);
});

test("search chips come from the popularity API, with honest thin-data copy", () => {
  const overlay = compact(source("src/components/search-overlay.tsx"));
  assert.doesNotMatch(overlay, /const TRENDING/);
  assert.match(overlay, /fetch\(`\/api\/popularity\?loc=\$\{locality\.key\}`/);
  assert.match(overlay, /setPopularity\(value && Array\.isArray\(value\.dishes\) \? value : null\)/);
  assert.match(overlay, /Trending in \{popularity\.scopeLabel \|\| locality\.name\}/);
  assert.match(overlay, /Search trending dish \$\{dish\.name\}/);
  assert.match(overlay, /From real orders in the last \{popularity\.windowDays\} days/);
  assert.match(overlay, /Local trends appear once enough orders have been placed here\./);
});
