/**
 * Customer search is a dish question first, a restaurant-name question second.
 * These source checks pin the query contract: a restaurant selling "Paneer
 * Tikka" must outrank a kitchen merely named after it, and a dish that is not
 * available cannot occupy a search slot.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const queries = source("src/db/queries.ts");
const searchAll = queries.slice(
  queries.indexOf("export async function searchAll"),
  queries.indexOf("export async function restaurantsBySlugs"),
);
const browse = queries.slice(
  queries.indexOf("export async function browseRestaurants"),
  queries.indexOf("export async function featuredRestaurants"),
);
const overlay = source("src/components/search-overlay.tsx");
const types = source("src/lib/types.ts");

test("dish search matches name, category and description", () => {
  const code = compact(searchAll);
  assert.match(code, /ilike\(menuItems\.name, like\)/);
  assert.match(code, /ilike\(menuItems\.category, like\)/);
  assert.match(code, /ilike\(menuItems\.description, like\)/);
});

test("dish search only returns sellable dishes from discoverable restaurants", () => {
  const code = compact(searchAll);
  assert.match(code, /eq\(menuItems\.available, true\)/);
  assert.match(code, /discoverableRestaurant/);
});

test("dish relevance outranks bestseller status and restaurant-name rank", () => {
  const code = compact(searchAll);
  assert.match(code, /orderBy\(desc\(dishRank\), desc\(menuItems\.isBestseller\)/);
  assert.match(code, /orderBy\(desc\(restaurantRank\), desc\(publicRatingSql\)/);
  assert.ok(queries.indexOf("nameExact: 100") < queries.indexOf("nameExact: 60"));
  assert.match(queries, /cuisineContains: 35/);
});

test("dish hits are returned before restaurant hits", () => {
  assert.ok(searchAll.includes("return [...dishResults, ...restResults]"));
  assert.ok(overlay.indexOf(">Dishes</h3>") < overlay.indexOf(">Restaurants</h3>"));
});

test("browse q also searches dishes and ranks them ahead of name-only hits", () => {
  const code = compact(browse);
  assert.match(code, /mi\.name ilike \$\{like\} or mi\.description ilike \$\{like\} or mi\.category ilike \$\{like\}/);
  assert.match(code, /mi\.available = true/);
  assert.match(code, /desc\(browseMatchRankSql\(filters\.q\)\)/);
});

test("match labels explain why an indirect result appeared", () => {
  assert.match(types, /SearchMatchKind = "name" \| "category" \| "description" \| "cuisine" \| "tagline"/);
  assert.match(overlay, /Category match/);
  assert.match(overlay, /Cuisine match/);
});

test("match kinds are classified by exact rank, not cumulative thresholds", () => {
  assert.doesNotMatch(queries, /if \(rank >= SEARCH_RANK\.dish\.nameContains\)/);
  assert.doesNotMatch(queries, /if \(rank >= SEARCH_RANK\.restaurant\.nameContains\)/);
  assert.match(queries, /rank === r\.categoryExact/);
  assert.match(queries, /rank === r\.cuisineExact/);
});

test("user wildcards stay escaped in both search paths", () => {
  assert.match(queries, /function containsLike\(q: string\)/);
  assert.match(queries, /escapeLike\(q\)/);
  assert.doesNotMatch(compact(searchAll), /`%\$\{q\}%`/);
});
