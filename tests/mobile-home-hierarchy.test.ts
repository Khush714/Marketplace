/**
 * Mobile M1: discovery must win the first screen. Offers stay visible as a
 * compact strip, while full-height editorial promos sit below restaurant rails.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

test("homepage hierarchy puts restaurant discovery before editorial promos", () => {
  const home = source("src/app/page.tsx");
  const markers = [
    "<HomeHero",
    "<OfferStrip",
    "Popular dishes near",
    "Featured tonight",
    "Restaurants near you",
    "Top rated",
    "All restaurants",
    "The Ember Drop",
  ];
  const positions = markers.map((marker) => {
    const at = home.indexOf(marker);
    assert.notEqual(at, -1, `missing homepage marker: ${marker}`);
    return at;
  });

  for (let i = 1; i < positions.length; i++) {
    assert.ok(positions[i - 1] < positions[i], `${markers[i - 1]} must precede ${markers[i]}`);
  }
});

test("offers use a compact strip rather than a full card grid", () => {
  const strip = source("src/components/offer-strip.tsx");

  assert.match(strip, /overflow-x-auto/);
  assert.match(strip, /rounded-full/);
  assert.doesNotMatch(strip, /RestaurantCard/);
});
