/**
 * Temporary closures must expire without a cron and leave days must use the
 * merchant's India calendar date, not the server's UTC date. These are the pure
 * rules shared by discovery, checkout and the paired integration API.
 *
 * Run with: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanClosureReason,
  closedReason,
  indiaDate,
  isRestaurantClosed,
  parseClosureUntil,
  parseScheduledLeaves,
} from "../src/lib/restaurant-closure";

const now = new Date("2026-11-19T06:00:00.000Z"); // 11:30 IST

test("a closure window expires on its own and does not change the base switch", () => {
  const until = parseClosureUntil("2026-11-19T08:00:00.000Z", now);
  assert.equal(isRestaurantClosed({ isActive: true, closureUntil: until }, now), true);
  assert.equal(isRestaurantClosed({ isActive: true, closureUntil: until }, new Date("2026-11-19T09:00:00.000Z")), false);
  assert.equal(isRestaurantClosed({ isActive: false }, now), true);
});

test("leave days use Asia/Kolkata dates and can be validated before storage", () => {
  const leaves = parseScheduledLeaves([
    { date: "2026-11-19", reason: "Festival" },
    { date: "2026-11-19", reason: "duplicate" },
  ]);
  assert.deepEqual(leaves, [{ date: "2026-11-19", reason: "Festival" }]);
  assert.equal(indiaDate(now), "2026-11-19");
  assert.equal(isRestaurantClosed({ isActive: true, scheduledLeaves: leaves }, now), true);
  assert.equal(isRestaurantClosed({ isActive: true, scheduledLeaves: leaves }, new Date("2026-11-20T06:00:00.000Z")), false);
  assert.equal(closedReason({ isActive: true, scheduledLeaves: leaves }, now), "Festival");
});

test("hostile closure values fail closed", () => {
  assert.equal(cleanClosureReason("  Private event  "), "Private event");
  assert.throws(() => parseClosureUntil("2026-11-19T05:00:00.000Z", now));
  assert.throws(() => parseScheduledLeaves([{ date: "2026-02-30" }]));
  assert.throws(() => parseScheduledLeaves(Array.from({ length: 61 }, () => ({ date: "2026-12-01" }))));
});
