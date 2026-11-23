/**
 * M2: listing status is derived from the same published rules the browse filter
 * and checkout use. The helper is pure so the clock can be pinned for IST
 * boundaries, overnight hours and merchant closures.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { listingAvailability, type ListingAvailabilityInput } from "@/lib/restaurant-availability-core";

const base: ListingAvailabilityInput = {
  isActive: true,
  merchantHoursEnabled: true,
  merchantOpensAt: "09:00",
  merchantClosesAt: "22:00",
  merchantDeliveryEnabled: true,
  closureUntil: null,
  scheduledLeaves: [],
};

const at = (iso: string) => new Date(iso);

test("published hours decide open status on the Asia/Kolkata clock", () => {
  assert.deepEqual(
    listingAvailability(base, at("2026-11-22T10:00:00.000Z")),
    { openNow: true, deliveryAvailable: true },
  );
  assert.equal(listingAvailability(base, at("2026-11-22T03:00:00.000Z")).openNow, false);
  assert.equal(listingAvailability(base, at("2026-11-22T17:00:00.000Z")).openNow, false);
});

test("overnight ranges wrap midnight without claiming the closing minute", () => {
  const overnight: ListingAvailabilityInput = {
    ...base,
    merchantOpensAt: "22:00",
    merchantClosesAt: "06:00",
  };
  assert.equal(listingAvailability(overnight, at("2026-11-22T17:00:00.000Z")).openNow, true);
  assert.equal(listingAvailability(overnight, at("2026-11-21T23:30:00.000Z")).openNow, true);
  assert.equal(listingAvailability(overnight, at("2026-11-22T00:30:00.000Z")).openNow, false);
});

test("invalid or equal published times fail closed", () => {
  for (const patch of [
    { merchantOpensAt: "9:00" },
    { merchantClosesAt: "25:00" },
    { merchantOpensAt: "09:00", merchantClosesAt: "09:00" },
  ]) {
    assert.deepEqual(
      listingAvailability({ ...base, ...patch }, at("2026-11-22T10:00:00.000Z")),
      { openNow: false, deliveryAvailable: false },
    );
  }
});

test("delivery follows the Merchant App toggle but never overrides a closed kitchen", () => {
  const pickupOnly: ListingAvailabilityInput = { ...base, merchantDeliveryEnabled: false };
  assert.deepEqual(
    listingAvailability(pickupOnly, at("2026-11-22T10:00:00.000Z")),
    { openNow: true, deliveryAvailable: false },
  );
  assert.deepEqual(
    listingAvailability(pickupOnly, at("2026-11-22T17:00:00.000Z")),
    { openNow: false, deliveryAvailable: false },
  );
});

test("temporary closures and IST leave days close the listing even inside hours", () => {
  const now = at("2026-11-22T10:00:00.000Z");
  assert.equal(
    listingAvailability(
      { ...base, closureUntil: "2026-11-22T12:00:00.000Z" },
      now,
    ).openNow,
    false,
  );
  assert.equal(
    listingAvailability(
      { ...base, closureUntil: "2026-11-22T09:00:00.000Z" },
      now,
    ).openNow,
    true,
  );
  assert.equal(
    listingAvailability(
      { ...base, scheduledLeaves: [{ date: "2026-11-22", reason: "Private event" }] },
      now,
    ).openNow,
    false,
  );
});

test("hours disabled means open, but closures still win", () => {
  const alwaysOpen: ListingAvailabilityInput = {
    ...base,
    merchantHoursEnabled: false,
    merchantOpensAt: "bad",
    merchantClosesAt: "bad",
  };
  assert.equal(listingAvailability(alwaysOpen, at("2026-11-22T02:00:00.000Z")).openNow, true);
  assert.equal(
    listingAvailability(
      { ...alwaysOpen, scheduledLeaves: [{ date: "2026-11-22", reason: "Leave" }] },
      at("2026-11-22T10:00:00.000Z"),
    ).openNow,
    false,
  );
});
