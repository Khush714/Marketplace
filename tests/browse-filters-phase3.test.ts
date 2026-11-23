/**
 * Phase 3: browse filters are URL-driven, allow-listed, and share the same
 * availability rules checkout enforces. The pure param helper is tested
 * directly; server/UI wiring is asserted from source because these are Server
 * Components and Drizzle fragments.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  activeFilterCount,
  browseHref,
  parseBrowseParams,
  parseMaxDeliveryMinutes,
  parsePriceLevel,
  withBrowseParam,
} from "@/lib/browse-filter-params";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

test("flags only turn on for the literal 1, including repeated params", () => {
  const parsed = parseBrowseParams({
    open: "1",
    delivery: "1",
    offers: "0",
    minRating: ["1", "0"],
    veg: "true",
  });
  assert.equal(parsed.openNow, true);
  assert.equal(parsed.delivery, true);
  assert.equal(parsed.offers, false);
  assert.equal(parsed.minRating, true);
  assert.equal(parsed.veg, false);
});

test("price and delivery time accept only the advertised choices", () => {
  assert.equal(parsePriceLevel("1"), 1);
  assert.equal(parsePriceLevel("4"), 4);
  assert.equal(parsePriceLevel("0"), undefined);
  assert.equal(parsePriceLevel("5"), undefined);
  assert.equal(parsePriceLevel("2; drop table"), undefined);
  assert.equal(parsePriceLevel(["2", "3"]), 2);

  assert.equal(parseMaxDeliveryMinutes("20"), 20);
  assert.equal(parseMaxDeliveryMinutes("45"), 45);
  assert.equal(parseMaxDeliveryMinutes("10"), undefined);
  assert.equal(parseMaxDeliveryMinutes("999999999999"), undefined);
  assert.equal(parseMaxDeliveryMinutes("30 OR true"), undefined);
});

test("parsing drops unknown sorts and keeps the query for result copy", () => {
  const parsed = parseBrowseParams({ q: " paneer ", sort: "rating;drop", price: "2", maxTime: "30", loc: "old-city" });
  assert.equal(parsed.sort, undefined);
  assert.equal(parsed.q, " paneer ");
  assert.equal(parsed.price, 2);
  assert.equal(parsed.maxTime, 30);
  assert.equal(parsed.loc, "old-city");
  assert.equal(parseBrowseParams({ sort: "fast" }).sort, "fast");
});

test("URL patching preserves the search and locality while removing toggles", () => {
  const base = { q: "paneer", cuisine: "North Indian", loc: "old-city", offers: "1" };
  const withFilters = withBrowseParam(base, { open: "1", delivery: "1", price: "2", maxTime: "30" });
  const url = new URL(withFilters, "https://marketplace-xyz.vercel.app");
  assert.equal(url.searchParams.get("q"), "paneer");
  assert.equal(url.searchParams.get("cuisine"), "North Indian");
  assert.equal(url.searchParams.get("loc"), "old-city");
  assert.equal(url.searchParams.get("offers"), "1");
  assert.equal(url.searchParams.get("price"), "2");
  assert.equal(url.searchParams.get("maxTime"), "30");

  const removed = withBrowseParam({ ...base, price: "2", maxTime: "30" }, { price: undefined, maxTime: undefined });
  assert.doesNotMatch(removed, /price=/);
  assert.doesNotMatch(removed, /maxTime=/);
  assert.equal(browseHref({}), "/restaurants");
});

test("the mobile badge counts only applied filters", () => {
  assert.equal(activeFilterCount({ sort: "", offers: "0", price: "9", maxTime: "12" }), 0);
  assert.equal(
    activeFilterCount({ offers: "1", open: "1", delivery: "1", price: "3", maxTime: "20", sort: "fast" }),
    6,
  );
});

const availability = source("src/db/availability.ts");
const queries = source("src/db/queries.ts");
const page = source("src/app/restaurants/page.tsx");
const apiRoute = source("src/app/api/restaurants/route.ts");
const filtersUi = source("src/components/browse-filters.tsx");

test("open-now SQL mirrors checkout's IST hours, including overnight ranges", () => {
  const code = compact(availability);
  assert.match(code, /Asia\/Kolkata', 'HH24:MI'/);
  assert.ok(code.includes("^([01][0-9]|2[0-3]):[0-5][0-9]$"));
  assert.match(code, /merchantHoursEnabled\} = false/);
  assert.match(code, /merchantOpensAt\} <> \$\{restaurants\.merchantClosesAt\}/);
  assert.match(code, /merchantOpensAt\} < \$\{restaurants\.merchantClosesAt\}/);
  assert.match(code, /merchantOpensAt\} > \$\{restaurants\.merchantClosesAt\}/);
  assert.match(code, /merchantDeliveryEnabled\} = true AND/);
});

test("browseRestaurants applies all four new constraints", () => {
  const start = queries.indexOf("export async function browseRestaurants");
  const end = queries.indexOf("export async function featuredRestaurants");
  const code = compact(queries.slice(start, end));
  assert.match(code, /if \(filters\.openNow\) conditions\.push\(openNowSql\)/);
  assert.match(code, /if \(filters\.delivery\) conditions\.push\(deliveryAvailableSql\)/);
  assert.match(code, /if \(filters\.price !== undefined\) conditions\.push\(eq\(restaurants\.priceLevel, filters\.price\)\)/);
  assert.match(code, /if \(filters\.maxTime !== undefined\) conditions\.push\(lte\(restaurants\.deliveryMinutes, filters\.maxTime\)\)/);
  assert.match(code, /discoverableRestaurant/);
});

test("server page and public API parse and forward the same filters", () => {
  for (const [name, code] of [
    ["page", compact(page)],
    ["api", compact(apiRoute)],
  ] as const) {
    assert.match(code, /parseBrowseParams\(/, name);
    assert.match(code, /openNow: parsed\.openNow/, name);
    assert.match(code, /delivery: parsed\.delivery/, name);
    assert.match(code, /price: parsed\.price/, name);
    assert.match(code, /maxTime: parsed\.maxTime/, name);
  }
  assert.match(apiRoute, /clampSearchQuery\(parsed\.q\)/);
  assert.match(apiRoute, /guardRead\(req, "restaurants"\)/);
});

test("desktop bar and mobile sheet both expose availability, cost and delivery time", () => {
  const code = compact(filtersUi);
  assert.match(code, /AvailabilityChips/);
  assert.match(code, /PriceChips/);
  assert.match(code, /TimeChips/);
  assert.match(code, /hidden md:flex/);
  assert.match(code, /max-h-\[82dvh\] overflow-y-auto/);
  assert.match(code, /published delivery estimate/);
  assert.match(code, /withBrowseParam\(\{\}, \{ loc: sp\.loc \}\)/);
  assert.match(code, /activeFilterCount\(sp\)/);
  assert.match(code, /closest\("button"\)/);
});

test("the desktop filter bar groups cannot shrink into overlapping stacks", () => {
  const code = compact(filtersUi);
  // A shrinkable group in the horizontal bar lets its shrink-0 chips spill over
  // the next group, or makes flex-wrap children stack vertically.
  assert.equal((code.match(/hidden shrink-0 items-center gap-2 border-l/g) ?? []).length, 2);
  assert.match(code, /mr-1 hidden shrink-0 items-center gap-2 border-r/);
  assert.match(code, /flex shrink-0 items-center gap-2 md:contents/);
  assert.match(code, /flex shrink-0 items-center gap-2 md:ml-1/);
  assert.equal((code.match(/flex shrink-0 flex-wrap gap-2/g) ?? []).length, 2);
  assert.match(code, /aria-label="Restaurant filters"/);
});
