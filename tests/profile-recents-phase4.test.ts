/**
 * Phase 4: recently searched dishes and recently viewed restaurants.
 *
 * The pure normalisers are tested directly because the profile blob lives in
 * user-writable localStorage. UI/provider wiring is asserted from source, the
 * same convention used for the other server/client rollout phases.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONSENT_CATEGORIES,
  CONSENT_STORAGE_KEY,
  CONSENT_VERSION,
} from "@/lib/consent";
import {
  RECENT_ITEMS_LIMIT,
  normalizeRecentDish,
  normalizeRecentRestaurant,
  recentDishFromSearch,
  recentRestaurantFromSearch,
  upsertRecentDish,
  upsertRecentRestaurant,
  type RecentDish,
  type RecentRestaurant,
} from "@/lib/recent-items";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const dish: RecentDish = {
  id: 42,
  name: "Paneer Tikka",
  imageUrl: "https://images.pexels.com/photos/123/paneer-tikka.jpg",
  restaurantSlug: "spice-hut",
  restaurantName: "Spice Hut",
  priceCents: 28000,
  isVeg: true,
};

const restaurant: RecentRestaurant = {
  slug: "spice-hut",
  name: "Spice Hut",
  imageUrl: "https://images.pexels.com/photos/456/spice-hut.jpg",
  cuisines: ["Indian", "North Indian"],
  rating: 4.5,
  ratingsCount: 120,
  deliveryMinutes: 30,
};

test("recent dishes round-trip and reject hand-edited values", () => {
  assert.deepEqual(normalizeRecentDish(dish), dish);
  assert.equal(normalizeRecentDish({ ...dish, id: 0 }), null);
  assert.equal(normalizeRecentDish({ ...dish, id: 1.5 }), null);
  assert.equal(normalizeRecentDish({ ...dish, name: "   " }), null);
  assert.equal(normalizeRecentDish({ ...dish, priceCents: -1 }), null);
  assert.equal(normalizeRecentDish({ ...dish, imageUrl: "javascript:alert(1)" }), null);
  assert.equal(normalizeRecentDish({ ...dish, imageUrl: "https://evil.example/x.jpg" }), null);
  assert.equal(normalizeRecentDish(null), null);
  assert.equal(normalizeRecentDish("Paneer Tikka"), null);
});

test("recent restaurants sanitise cuisines and reject unsafe images or ratings", () => {
  assert.deepEqual(normalizeRecentRestaurant(restaurant), restaurant);
  assert.deepEqual(
    normalizeRecentRestaurant({
      ...restaurant,
      cuisines: [" Indian ", "", 42, "North Indian"],
    }),
    restaurant,
  );
  assert.equal(normalizeRecentRestaurant({ ...restaurant, rating: 9 }), null);
  assert.equal(normalizeRecentRestaurant({ ...restaurant, deliveryMinutes: NaN }), null);
  assert.equal(normalizeRecentRestaurant({ ...restaurant, imageUrl: "data:text/html,x" }), null);
  assert.equal(normalizeRecentRestaurant([]), null);
});

test("re-opening a recent moves it to the front and de-duplicates it", () => {
  const second: RecentDish = { ...dish, id: 7, name: "Dosa" };
  const first = upsertRecentDish(upsertRecentDish([], second), dish);
  assert.deepEqual(first.map((d) => d.id), [42, 7]);

  const renamed = upsertRecentDish(first, { ...dish, name: "Tandoori Paneer" });
  assert.equal(renamed.length, 2);
  assert.equal(renamed[0].name, "Tandoori Paneer");

  const seen = upsertRecentRestaurant(upsertRecentRestaurant([], restaurant), {
    ...restaurant,
    rating: 4.8,
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].rating, 4.8);
});

test("recents are capped so the profile blob cannot grow without limit", () => {
  let dishes: RecentDish[] = [];
  for (let id = 1; id <= RECENT_ITEMS_LIMIT + 4; id++) {
    dishes = upsertRecentDish(dishes, { ...dish, id });
  }
  assert.equal(dishes.length, RECENT_ITEMS_LIMIT);
  assert.equal(dishes[0].id, RECENT_ITEMS_LIMIT + 4);
  assert.equal(dishes.at(-1)?.id, 5);

  let restaurants: RecentRestaurant[] = [];
  for (let i = 0; i < RECENT_ITEMS_LIMIT + 3; i++) {
    restaurants = upsertRecentRestaurant(restaurants, { ...restaurant, slug: `kitchen-${i}` });
  }
  assert.equal(restaurants.length, RECENT_ITEMS_LIMIT);
  assert.equal(restaurants[0].slug, `kitchen-${RECENT_ITEMS_LIMIT + 2}`);
});

test("search and DTO adapters keep only display-safe fields", () => {
  assert.deepEqual(
    recentDishFromSearch({
      type: "dish",
      id: dish.id,
      name: dish.name,
      priceCents: dish.priceCents,
      isVeg: dish.isVeg,
      imageUrl: dish.imageUrl,
      restaurantSlug: dish.restaurantSlug,
      restaurantName: dish.restaurantName,
      match: "name",
    }),
    dish,
  );
  assert.deepEqual(
    recentRestaurantFromSearch({
      type: "restaurant",
      slug: restaurant.slug,
      name: restaurant.name,
      cuisines: restaurant.cuisines,
      rating: restaurant.rating,
      ratingsCount: restaurant.ratingsCount,
      deliveryMinutes: restaurant.deliveryMinutes,
      imageUrl: restaurant.imageUrl,
      offer: null,
      match: "name",
    }),
    restaurant,
  );
});

test("profile state hydrates, validates and clears every recents slice", () => {
  const profile = compact(source("src/lib/profile.tsx"));
  assert.match(profile, /recentDishes: RecentDish\[\];/);
  assert.match(profile, /recentRestaurants: RecentRestaurant\[\];/);
  assert.match(profile, /recentDishes: \[\], recentRestaurants: \[\],/);
  assert.match(profile, /\.map\(normalizeRecentDish\)/);
  assert.match(profile, /\.map\(normalizeRecentRestaurant\)/);
  assert.match(profile, /recentDishes: upsertRecentDish\(s\.recentDishes, dish\)/);
  assert.match(profile, /recentRestaurants: upsertRecentRestaurant\(s\.recentRestaurants, restaurant\)/);
  assert.match(profile, /rememberDish[\s\S]{0,160}if \(!personalisationAllowed\) return;/);
  assert.match(profile, /rememberRestaurant[\s\S]{0,160}if \(!personalisationAllowed\) return;/);
  assert.match(profile, /export function useRecentItems\(\)/);
  assert.match(profile, /resetIdentity[\s\S]{0,400}recentDishes: \[\], recentRestaurants: \[\],/);
  assert.match(profile, /clearPersonalisation[\s\S]{0,500}recentDishes: \[\],/);
  assert.match(profile, /clearPersonalisation[\s\S]{0,500}recentRestaurants: \[\],/);
  assert.match(profile, /export function useProfilePersonalisation\(\)/);
});

test("restaurant detail records one view after profile hydration", () => {
  const recorder = compact(source("src/components/recent-restaurant-recorder.tsx"));
  assert.match(recorder, /if \(!hydrated \|\| recordedSlug\.current === restaurant\.slug\) return;/);
  assert.match(recorder, /rememberRestaurant\(restaurant\)/);

  const detail = compact(source("src/app/restaurants/[slug]/page.tsx"));
  assert.match(detail, /<RecentRestaurantRecorder restaurant=\{recentRestaurantFromDto\(r\)\} \/>/);
});

test("search overlay shows all three recents groups and writes dish recents", () => {
  const overlay = compact(source("src/components/search-overlay.tsx"));
  assert.match(overlay, /aria-label="Recent searches"/);
  assert.match(overlay, /aria-label="Recent dishes"/);
  assert.match(overlay, /aria-label="Recent restaurants"/);
  assert.match(overlay, /aria-label="Clear recent searches"/);
  assert.match(overlay, /aria-label="Clear recent dishes"/);
  assert.match(overlay, /aria-label="Clear recent restaurants"/);
  assert.match(overlay, /openDish\(recentDishFromSearch\(d\)\)/);
  assert.match(overlay, /rememberDish\(dish\)/);
  assert.match(overlay, /openRestaurant\(recentRestaurantFromSearch\(r\)\)/);
});

test("profile page exposes recents to guests, outside the signed-in block", () => {
  const page = compact(source("src/app/profile/page.tsx"));
  const recentsAt = page.indexOf('aria-label="Recent activity"');
  const signedInAt = page.indexOf("{signedIn && (<>");
  assert.ok(recentsAt >= 0, "profile page has no recents section");
  assert.ok(signedInAt >= 0, "signed-in block marker changed");
  assert.ok(recentsAt < signedInAt, "recents must not be hidden behind sign-in");
  assert.match(page, /profile\.recentDishes\.length > 0/);
  assert.match(page, /profile\.recentRestaurants\.length > 0/);
  assert.match(page, /aria-label="Clear all recents"/);
  assert.match(page, /onClick=\{profile\.clearRecents\}/);
});

test("consent names the new recents data and asks again after the change", () => {
  assert.equal(CONSENT_VERSION, 3);
  assert.equal(CONSENT_STORAGE_KEY, "crave.consent.v3");
  const personalisation = CONSENT_CATEGORIES.find((c) => c.id === "personalisation");
  assert.ok(personalisation, "personalisation category is missing");
  assert.match(personalisation.label, /recents/i);
  assert.ok(personalisation.held.some((item) => /recently opened/i.test(item)));

  const privacy = compact(source("src/app/privacy/page.tsx"));
  assert.match(privacy, /recently opened dishes or restaurants/);
  const banner = compact(source("src/components/consent-banner.tsx"));
  assert.match(banner, /recently viewed places/);
  assert.match(banner, /useProfilePersonalisation\(\)/);
});
