/**
 * Mobile M2: the browse grid uses a compact comparison row, and every fact it
 * prints already exists in RestaurantDto. No client-side clock, no invented
 * minimum order, noPromises about POS readiness.
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

const types = source("src/lib/types.ts");
const queries = source("src/db/queries.ts");
const card = compact(source("src/components/restaurant-card.tsx"));
const page = compact(source("src/app/restaurants/page.tsx"));
const home = source("src/app/page.tsx");

test("RestaurantDto carries server-derived open and delivery facts", () => {
  assert.match(types, /openNow: boolean;/);
  assert.match(types, /deliveryAvailable: boolean;/);
  assert.match(queries, /const availability = listingAvailability\(r\)/);
  assert.match(queries, /openNow: availability\.openNow/);
  assert.match(queries, /deliveryAvailable: availability\.deliveryAvailable/);
});

test("the compact row renders only source-backed facts", () => {
  assert.match(card, /variant\?: "card" \| "row"/);
  assert.match(card, /data-restaurant-card/);
  assert.match(card, /size-\[104px\]/);
  assert.match(card, /r\.openNow \? "Open" : "Closed"/);
  assert.match(card, /r\.deliveryAvailable \? "Delivery" : "No delivery"/);
  assert.match(card, /priceSymbol\(r\.priceLevel\)/);
  assert.match(card, /r\.deliveryMinutes/);
  assert.doesNotMatch(card, /minOrder|minimum order|Min order/i);
  assert.doesNotMatch(card, /Date\.now\(|new Date\(/);
  assert.doesNotMatch(card, /merchantHoursEnabled|merchantDeliveryEnabled/);
});

test("the listing page opts into compact rows while home rails keep poster cards", () => {
  assert.match(page, /variant="row"/);
  assert.match(page, /grid-cols-1 gap-x-5 gap-y-3/);
  assert.match(page, /text-\[26px\]/);
  assert.doesNotMatch(home, /variant="row"/);
});
