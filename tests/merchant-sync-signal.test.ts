import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { merchantSyncVersion, type MerchantSyncSnapshot } from "../src/lib/merchant-sync";

const base: MerchantSyncSnapshot = {
  count: 3,
  paidCount: 1,
  latestCreated: "2026-11-19 10:00:00+00",
  latestStatus: "2026-11-19 10:01:00+00",
  latestEvent: "42",
  latestFeedback: null,
  latestReply: null,
};

test("a stable snapshot produces stable tokens", () => {
  const first = merchantSyncVersion(base);
  assert.deepEqual(first, merchantSyncVersion({ ...base }));
  assert.match(first.orders, /^3\|1\|/);
  assert.equal(first.feedback, "-|-");
});

test("new orders and visibility changes move the orders token", () => {
  const before = merchantSyncVersion(base).orders;
  assert.notEqual(before, merchantSyncVersion({ ...base, count: 4 }).orders);
  assert.notEqual(before, merchantSyncVersion({ ...base, paidCount: 2 }).orders);
  assert.notEqual(before, merchantSyncVersion({ ...base, latestCreated: "2026-11-19 10:05:00+00" }).orders);
});

test("status transitions and silent edits both move the orders token", () => {
  const before = merchantSyncVersion(base).orders;
  assert.notEqual(before, merchantSyncVersion({ ...base, latestStatus: "2026-11-19 10:02:00+00" }).orders);
  // Fulfilment/address edits do not touch a timestamp; the event ledger catches them.
  assert.notEqual(before, merchantSyncVersion({ ...base, latestEvent: "43" }).orders);
});

test("reviews and replies move the feedback token", () => {
  const before = merchantSyncVersion(base).feedback;
  assert.notEqual(before, merchantSyncVersion({ ...base, latestFeedback: "2026-11-19 11:00:00+00" }).feedback);
  assert.notEqual(before, merchantSyncVersion({ ...base, latestReply: "2026-11-19 11:05:00+00" }).feedback);
});

test("the signal route is bearer-scoped, budgeted and wired to the restaurant version", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/api/integration/merchant/changes/route.ts"), "utf8",
  );
  assert.match(source, /guardBudget\(req, "merchantServiceSignal"\)/);
  assert.match(source, /authenticateMerchantApp\(req\)/);
  assert.match(source, /getMerchantSyncVersion\(auth\.restaurantId\)/);
  assert.match(source, /Cache-Control.*no-store/);
});
