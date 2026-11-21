/**
 * Pure DTO shaping for the item-level sales report exposed to the Merchant App.
 *
 * The database supplies integer paise; this module only clamps, bounds and
 * sorts it. Keeping it free of `server-only` lets the report contract be tested
 * without a database. Dates reuse the revenue range so both reports agree on
 * inclusive Asia/Kolkata calendar days.
 */

import type { MerchantRevenueRange } from "./merchant-revenue";

export type MerchantItemAnalyticsRow = {
  itemId: string | null;
  name: string;
  unitsSold: number;
  grossSales: number;
  orders: number;
};

export type MerchantItemAnalytics = {
  from: string | null;
  to: string | null;
  items: MerchantItemAnalyticsRow[];
  unitsSold: number;
  grossSales: number;
  itemsSold: number;
  currency: "INR";
};

const MAX_ITEMS = 100;
const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

function count(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function label(value: unknown): string {
  const text = typeof value === "string" ? value.replace(control, "").trim().slice(0, 120) : "";
  return text || "Unnamed item";
}

/** A stable, opaque handle: Marketplace ids are numeric, unpaired rows use names. */
function itemId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && /^\d{1,12}$/.test(value.trim())) return value.trim();
  return null;
}

type ItemAnalyticsInput = {
  itemId?: unknown;
  name?: unknown;
  unitsSold?: unknown;
  grossSales?: unknown;
  orders?: unknown;
};

export function merchantItemAnalyticsDto(
  range: MerchantRevenueRange,
  rows: readonly ItemAnalyticsInput[],
): MerchantItemAnalytics {
  const items = rows.map((row) => ({
    itemId: itemId(row.itemId),
    name: label(row.name),
    unitsSold: count(Number(row.unitsSold ?? 0)),
    grossSales: count(Number(row.grossSales ?? 0)),
    orders: count(Number(row.orders ?? 0)),
  }))
    .sort((a, b) => b.grossSales - a.grossSales || a.name.localeCompare(b.name))
    .slice(0, MAX_ITEMS);

  return {
    from: range.fromLabel,
    to: range.toLabel,
    items,
    unitsSold: items.reduce((sum, row) => sum + row.unitsSold, 0),
    grossSales: items.reduce((sum, row) => sum + row.grossSales, 0),
    itemsSold: items.length,
    currency: "INR",
  };
}
