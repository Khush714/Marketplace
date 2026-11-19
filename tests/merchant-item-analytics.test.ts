import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { merchantItemAnalyticsDto } from "../src/lib/merchant-item-analytics";
import { normalizeMerchantRevenueRange } from "../src/lib/merchant-revenue";

const range = normalizeMerchantRevenueRange("2026-11-01", "2026-11-07");

test("item analytics are shaped, clamped and sorted by gross sales", () => {
  const result = merchantItemAnalyticsDto(range, [
    { itemId: 12, name: "Small bowl", unitsSold: 2, grossSales: 40_000, orders: 2 },
    { itemId: 13, name: "Big bowl\u0000", unitsSold: "3", grossSales: "90000", orders: "3" },
    { itemId: null, name: "", unitsSold: -4, grossSales: -100, orders: -1 },
  ]);
  assert.deepEqual(result, {
    from: "2026-11-01",
    to: "2026-11-07",
    items: [
      { itemId: "13", name: "Big bowl", unitsSold: 3, grossSales: 90_000, orders: 3 },
      { itemId: "12", name: "Small bowl", unitsSold: 2, grossSales: 40_000, orders: 2 },
      { itemId: null, name: "Unnamed item", unitsSold: 0, grossSales: 0, orders: 0 },
    ],
    unitsSold: 5,
    grossSales: 130_000,
    itemsSold: 3,
    currency: "INR",
  });
});

test("item analytics cap the number of rows without inflating totals", () => {
  const rows = Array.from({ length: 150 }, (_, i) => ({
    itemId: i + 1,
    name: `Item ${i}`,
    unitsSold: 1,
    grossSales: 150 - i,
    orders: 1,
  }));
  const result = merchantItemAnalyticsDto(range, rows);
  assert.equal(result.items.length, 100);
  assert.equal(result.itemsSold, 100);
  assert.equal(result.unitsSold, 100);
  assert.equal(result.grossSales, rows.slice(0, 100).reduce((sum, row) => sum + row.grossSales, 0));
});

test("the integration route stays guarded, tenant-scoped and uncached", () => {
  const source = readFileSync(
    "src/app/api/integration/merchant/item-analytics/route.ts",
    "utf8",
  );
  assert.match(source, /guardBudget\(req, "merchantServiceRead"\)/);
  assert.match(source, /authenticateMerchantApp\(req\)/);
  assert.match(source, /auth\.restaurantId/);
  assert.match(source, /normalizeMerchantRevenueRange/);
  assert.match(source, /Cache-Control": "no-store/);
});
