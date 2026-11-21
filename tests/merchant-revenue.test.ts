/**
 * The Merchant App sends a date range; Marketplace must reject anything that
 * could widen a tenant's revenue view or silently mean a different period.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MerchantRevenueRangeError,
  merchantRevenueDto,
  normalizeMerchantRevenueRange,
} from "../src/lib/merchant-revenue";

test("all time is represented without date bounds", () => {
  const range = normalizeMerchantRevenueRange(null, null);
  assert.equal(range.fromDate, null);
  assert.equal(range.toExclusive, null);
  assert.equal(range.fromLabel, null);
  assert.equal(range.toLabel, null);
});

test("an inclusive IST day becomes an exclusive UTC query bound", () => {
  const range = normalizeMerchantRevenueRange("2026-11-01", "2026-11-07");
  assert.equal(range.fromDate?.toISOString(), "2026-10-31T18:30:00.000Z");
  assert.equal(range.toExclusive?.toISOString(), "2026-11-07T18:30:00.000Z");
});

test("partial, reversed and impossible ranges are rejected", () => {
  assert.throws(() => normalizeMerchantRevenueRange("2026-11-01", null), MerchantRevenueRangeError);
  assert.throws(() => normalizeMerchantRevenueRange("2026-11-08", "2026-11-07"), MerchantRevenueRangeError);
  assert.throws(() => normalizeMerchantRevenueRange("2026-02-30", "2026-03-01"), MerchantRevenueRangeError);
  assert.throws(() => normalizeMerchantRevenueRange("01/11/2026", "07/11/2026"), MerchantRevenueRangeError);
});

test("revenue DTO carries authoritative totals and echoes the selected range", () => {
  const range = normalizeMerchantRevenueRange("2026-11-01", "2026-11-07");
  const dto = merchantRevenueDto(range, {
    grossSales: 125_000,
    netPaid: 112_300,
    completedOrders: 12,
    paidSettlements: 11,
  });
  assert.deepEqual(dto, {
    from: "2026-11-01",
    to: "2026-11-07",
    grossSales: 125_000,
    netPaid: 112_300,
    completedOrders: 12,
    paidSettlements: 11,
    currency: "INR",
  });
});
