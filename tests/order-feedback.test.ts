/**
 * Delivered-order feedback is the trust boundary between a customer browser and
 * the paired Merchant App. These tests pin the pure rules shared by both paths:
 * what a customer may write, what a restaurant may reply, and the shape of the
 * summary the Merchant App renders.
 *
 * Run with: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FEEDBACK_WINDOW_DAYS,
  MAX_REVIEW_CHARS,
  feedbackDto,
  feedbackSummary,
  parseReplyInput,
  parseReviewInput,
  type FeedbackRow,
} from "../src/lib/order-feedback";

function row(overrides: Partial<FeedbackRow> = {}): FeedbackRow {
  return {
    rating: 5,
    review: "Lovely food",
    feedbackAt: new Date("2026-11-19T10:00:00.000Z"),
    merchantResponse: "",
    merchantRespondedAt: null,
    ...overrides,
  };
}

test("a review takes only an integer rating and a bounded comment", () => {
  assert.deepEqual(parseReviewInput({ rating: 4, review: "  Great  " }), { rating: 4, review: "Great" });
  assert.deepEqual(parseReviewInput({ rating: 1 }), { rating: 1, review: "" });
  assert.equal(parseReviewInput({ rating: 0 }), null);
  assert.equal(parseReviewInput({ rating: 6 }), null);
  assert.equal(parseReviewInput({ rating: 2.5 }), null);
  assert.equal(parseReviewInput({ rating: "5" }), null);
  assert.equal(parseReviewInput({ rating: 3, review: 42 }), null);
  assert.equal(parseReviewInput({ rating: 3, review: "x".repeat(700) })?.review.length, MAX_REVIEW_CHARS);
});

test("a merchant reply is required and cannot smuggle in review fields", () => {
  assert.equal(parseReplyInput({ response: "  Thank you!  " }), "Thank you!");
  assert.equal(parseReplyInput({ response: "   " }), null);
  assert.equal(parseReplyInput({ response: 5 }), null);
  assert.equal(parseReplyInput({ response: "y".repeat(700) })?.length, MAX_REVIEW_CHARS);
  const reply = parseReplyInput({ response: "Thanks", rating: 5, feedbackAt: "2020-01-01T00:00:00.000Z" });
  assert.equal(reply, "Thanks");
});

test("the DTO exposes only the five fields the Merchant App parses", () => {
  const dto = feedbackDto(row({ merchantResponse: "Thanks!", merchantRespondedAt: new Date("2026-11-19T11:00:00.000Z") }));
  assert.deepEqual(Object.keys(dto).sort(), [
    "feedbackAt", "merchantRespondedAt", "merchantResponse", "rating", "review",
  ]);
  assert.equal(dto.feedbackAt, "2026-11-19T10:00:00.000Z");
  assert.equal(dto.merchantRespondedAt, "2026-11-19T11:00:00.000Z");
  assert.deepEqual(feedbackDto(row()).merchantRespondedAt, null);
});

test("the summary counts only the rolling window and matches Merchant defaults", () => {
  const now = new Date("2026-11-19T12:00:00.000Z");
  const summary = feedbackSummary([
    row({ rating: 5, review: "Great", merchantResponse: "Thanks" }),
    row({ rating: 1, review: "Bad", merchantResponse: "" }),
    row({ rating: 4, review: "Fine", merchantResponse: "" }),
    // Outside the 30-day window: must not affect any metric.
    row({ rating: 1, review: "Old", feedbackAt: new Date(now.getTime() - (FEEDBACK_WINDOW_DAYS + 1) * 86_400_000) }),
  ], now);
  assert.equal(summary.available, true);
  assert.equal(summary.windowDays, FEEDBACK_WINDOW_DAYS);
  assert.equal(summary.reviewCount, 3);
  assert.equal(summary.averageRating, 3.3);
  assert.equal(summary.badOrders, 1);
  assert.equal(summary.pendingReplies, 2);
});

test("an empty feedback inbox is still an available, zeroed summary", () => {
  assert.deepEqual(feedbackSummary([]), {
    available: true,
    windowDays: FEEDBACK_WINDOW_DAYS,
    averageRating: null,
    reviewCount: 0,
    badOrders: 0,
    pendingReplies: 0,
  });
});
