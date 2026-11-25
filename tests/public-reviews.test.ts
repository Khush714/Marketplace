/**
 * Public reviews are a read-only projection of delivered-order feedback. These
 * tests pin the boundary: a browser can page through bounded rows, but the DTO
 * never carries an order code, a customer identity, or a restaurant id.
 *
 * Run with: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_PUBLIC_REVIEW_PAGE_SIZE,
  MAX_PUBLIC_REVIEW_PAGE_SIZE,
  decodePublicReviewCursor,
  encodePublicReviewCursor,
  parsePublicReviewLimit,
  publicReviewDto,
} from "../src/lib/public-review-core";

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

test("a public review inherits the feedback DTO and nothing else", () => {
  const dto = publicReviewDto({
    id: 41,
    rating: 4,
    review: "Lovely food",
    feedbackAt: new Date("2026-11-19T10:00:00.000Z"),
    merchantResponse: "Thank you!",
    merchantRespondedAt: new Date("2026-11-19T11:00:00.000Z"),
    reviewPhotoIds: [12, 13],
  });

  assert.deepEqual(Object.keys(dto).sort(), [
    "feedbackAt", "merchantRespondedAt", "merchantResponse", "photoUrls", "rating", "review",
  ]);
  assert.equal(dto.rating, 4);
  assert.equal(dto.feedbackAt, "2026-11-19T10:00:00.000Z");
  assert.equal(dto.merchantRespondedAt, "2026-11-19T11:00:00.000Z");
  assert.deepEqual(dto.photoUrls, ["/api/media/12", "/api/media/13"]);
});

test("a page size is bounded and bad input falls back to the default", () => {
  assert.equal(parsePublicReviewLimit(null), DEFAULT_PUBLIC_REVIEW_PAGE_SIZE);
  assert.equal(parsePublicReviewLimit(""), DEFAULT_PUBLIC_REVIEW_PAGE_SIZE);
  assert.equal(parsePublicReviewLimit("abc"), DEFAULT_PUBLIC_REVIEW_PAGE_SIZE);
  assert.equal(parsePublicReviewLimit("2.9"), 2);
  assert.equal(parsePublicReviewLimit("0"), 1);
  assert.equal(parsePublicReviewLimit("999"), MAX_PUBLIC_REVIEW_PAGE_SIZE);
});

test("a cursor round-trips the timestamp and id used to break ties", () => {
  const cursor = { feedbackAt: new Date("2026-11-19T10:00:00.000Z"), id: 42 };
  const encoded = encodePublicReviewCursor(cursor);
  assert.equal(encoded.startsWith("pr1."), true);
  assert.deepEqual(decodePublicReviewCursor(encoded), cursor);
  assert.deepEqual(decodePublicReviewCursor(`  ${encoded}  `), cursor);
});

test("a malformed or forged cursor is ignored instead of widening the query", () => {
  for (const raw of [
    null,
    "",
    "pr1.nope.1",
    "other.1.1",
    "pr1.1.0",
    "pr1.-1.1",
    "pr1.zzzzzzzzzzzzzz.1",
  ]) {
    assert.equal(decodePublicReviewCursor(raw), null, `accepted bad cursor: ${raw}`);
  }
});

test("the public review query is scoped to the active listing and its reviews", () => {
  const source = readSource("src/db/public-reviews.ts");
  assert.match(source, /eq\(restaurants\.slug, slug\)/);
  assert.match(source, /eq\(restaurants\.isActive, true\)/);
  assert.match(source, /eq\(orders\.restaurantId, restaurant\.id\)/);
  assert.match(source, /isNotNull\(orders\.feedbackAt\)/);
  assert.match(source, /isNotNull\(orders\.rating\)/);
  assert.doesNotMatch(
    source,
    /orders\.(code|customerName|customerPhone|customerEmail|customerAddress|phone|email|address)/,
  );
});

test("review pages are stable when several reviews share a timestamp", () => {
  const source = readSource("src/db/public-reviews.ts");
  assert.match(source, /desc\(orders\.feedbackAt\), desc\(orders\.id\)/);
  assert.match(source, /lt\(orders\.feedbackAt, cursor\.feedbackAt\)/);
  assert.match(source, /and\(eq\(orders\.feedbackAt, cursor\.feedbackAt\), lt\(orders\.id, cursor\.id\)\)/);
});

test("the public review route is guarded and non-cacheable", () => {
  const source = readSource("src/app/api/restaurants/[slug]/reviews/route.ts");
  assert.match(source, /guardRead\(req, "publicReviews"\)/);
  assert.match(source, /if \(throttled\) return throttled;/);
  assert.match(source, /Cache-Control": "no-store"/);
});

test("the restaurant page renders the public review section", () => {
  const source = readSource("src/app/restaurants/[slug]/page.tsx");
  assert.match(source, /PublicReviews slug=\{r\.slug\}/);
});
