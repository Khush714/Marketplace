/** Public ratings must come from real reviews, never the onboarding default. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { publicRating } from "../src/lib/public-rating-core";

test("a real review replaces the seeded demo score and count", () => {
  assert.deepEqual(
    publicRating({ rating: 4.2, ratingsCount: 1000 }, { averageRating: 3.666, reviewCount: 3 }),
    { rating: 3.7, ratingsCount: 3 },
  );
});

test("no reviews keeps the listing's own honest baseline", () => {
  const unrated = { rating: 0, ratingsCount: 0 };
  assert.deepEqual(publicRating(unrated, null), unrated);
  assert.deepEqual(publicRating(unrated, { averageRating: 5, reviewCount: 0 }), unrated);
  const seeded = { rating: 4.5, ratingsCount: 120 };
  assert.deepEqual(publicRating(seeded, undefined), seeded);
});

test("malformed aggregates cannot invent a public score", () => {
  const base = { rating: 4.1, ratingsCount: 20 };
  assert.deepEqual(publicRating(base, { averageRating: Number.NaN, reviewCount: 5 }), base);
  assert.deepEqual(publicRating(base, { averageRating: 9, reviewCount: 2 }), { rating: 5, ratingsCount: 2 });
});
