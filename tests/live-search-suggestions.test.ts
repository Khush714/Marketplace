/**
 * Phase 2: one debounced search request returns both result cards and compact
 * query refinements. The overlay must not fire a second request per keystroke.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSearchSuggestions } from "@/lib/search-suggestions";
import type { DishSearchResult, RestaurantSearchResult } from "@/lib/types";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function dish(id: number, name: string): DishSearchResult {
  return {
    type: "dish",
    id,
    name,
    priceCents: 100,
    isVeg: true,
    imageUrl: "https://images.pexels.com/photos/1/photo.jpg",
    restaurantSlug: `kitchen-${id}`,
    restaurantName: "Kitchen",
    match: "name",
  };
}

function restaurant(slug: string, name: string): RestaurantSearchResult {
  return {
    type: "restaurant",
    slug,
    name,
    cuisines: [],
    rating: 0,
    ratingsCount: 0,
    deliveryMinutes: 30,
    imageUrl: "https://images.pexels.com/photos/1/photo.jpg",
    offer: null,
    match: "name",
  };
}

test("suggestions combine results with cuisine and category refinements", () => {
  const suggestions = buildSearchSuggestions(
    "paneer",
    [dish(1, "Paneer Tikka"), restaurant("paneer-house", "Paneer House")],
    { cuisines: ["North Indian"], categories: ["Paneer Starters"] },
  );
  assert.deepEqual(
    suggestions.map((s) => `${s.kind}:${s.text}`),
    ["dish:Paneer Tikka", "category:Paneer Starters", "restaurant:Paneer House", "cuisine:North Indian"],
  );
  assert.equal(suggestions.find((s) => s.kind === "dish")?.dishId, 1);
  assert.equal(suggestions.find((s) => s.kind === "restaurant")?.restaurantSlug, "paneer-house");
});

test("exact suggestions rank before prefix and substring suggestions", () => {
  const suggestions = buildSearchSuggestions(
    "paneer",
    [dish(2, "Paneer Tikka"), dish(1, "Paneer"), dish(3, "Tandoori Paneer")],
    { cuisines: [], categories: [] },
  );
  assert.deepEqual(suggestions.map((s) => s.text), ["Paneer", "Paneer Tikka", "Tandoori Paneer"]);
});

test("suggestions are deduplicated and bounded", () => {
  const results = Array.from({ length: 12 }, (_, i) => dish(i + 1, `Paneer ${i}`));
  const suggestions = buildSearchSuggestions("paneer", results, {
    cuisines: ["Paneer", "Paneer", "North Indian"],
    categories: ["Paneer"],
  });
  assert.equal(suggestions.length, 8);
  assert.equal(new Set(suggestions.map((s) => `${s.kind}:${s.text.toLowerCase()}`)).size, 8);
});

const route = source("src/app/api/search/route.ts");
const overlay = source("src/components/search-overlay.tsx");
const queries = source("src/db/queries.ts");

test("search route returns facets on the same guarded request", () => {
  const code = compact(route);
  assert.match(code, /from "\@\/db\/queries";/);
  assert.match(route, /searchAll, searchFacets/);
  assert.match(route, /Promise\.all\(\[searchAll\(q, locality\), searchFacets\(q, locality\)\]\)/);
  assert.match(route, /suggestions: buildSearchSuggestions\(q, results, facets\)/);
  assert.match(route, /guardRead\(req, "search"\)/);
});

test("facet query keeps the escaping and discoverability guardrails", () => {
  const start = queries.indexOf("export async function searchFacets");
  const end = queries.indexOf("export async function restaurantsBySlugs");
  const code = compact(queries.slice(start, end));
  assert.match(code, /const like = containsLike\(q\)/);
  assert.match(code, /discoverableRestaurant/);
  assert.match(code, /eq\(menuItems\.available, true\)/);
  assert.match(code, /ilike\(menuItems\.category, like\)/);
  assert.match(code, /unnest\(\$\{restaurants\.cuisines\}\) c where c ilike \$\{like\}/);
  assert.match(code, /\.limit\(24\)/);
});

test("overlay debounces one request and protects against stale responses", () => {
  const code = compact(overlay);
  assert.match(code, /let active = true/);
  assert.match(code, /if \(!active\) return/);
  assert.match(code, /controller\.abort\(\)/);
  assert.match(code, /window\.setTimeout\(/);
  assert.equal((overlay.match(/\/api\/search\?q=/g) ?? []).length, 1);
  assert.match(code, /cache\.set\(key, payload\)/);
  assert.match(code, /if \(cache\.size >= 40\) cache\.delete/);
});

test("overlay exposes suggestions accessibly and ahead of result cards", () => {
  assert.match(overlay, /role="combobox"/);
  assert.match(overlay, /aria-autocomplete="list"/);
  assert.match(overlay, /aria-controls="search-results"/);
  assert.match(overlay, /id="search-results"/);
  assert.ok(overlay.indexOf("Suggestions</h3>") < overlay.indexOf(">Dishes</h3>"));
  assert.match(overlay, /No matches for/);
  assert.match(overlay, /\(suggestions\?\.length \?\? 0\) === 0/);
});
