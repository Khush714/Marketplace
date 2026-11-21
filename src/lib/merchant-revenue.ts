/**
 * Pure range validation and DTO shape for the revenue view exposed to the
 * Merchant App. Kept free of `server-only` imports so the rules can be tested
 * directly; the database function supplies the actual money.
 *
 * Dates are inclusive calendar days in Asia/Kolkata, the same business timezone
 * used by the Merchant App and the existing Marketplace overview metrics.
 */

export const REVENUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class MerchantRevenueRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MerchantRevenueRangeError";
  }
}

export type MerchantRevenueSummary = {
  from: string | null;
  to: string | null;
  grossSales: number;
  netPaid: number;
  completedOrders: number;
  paidSettlements: number;
  currency: "INR";
};

export type MerchantRevenueRange = {
  fromDate: Date | null;
  toExclusive: Date | null;
  fromLabel: string | null;
  toLabel: string | null;
};

function invalid(message: string): never {
  throw new MerchantRevenueRangeError(message);
}

function startOfIndiaDay(value: string): Date {
  if (!REVENUE_DATE_PATTERN.test(value)) invalid("Use dates in YYYY-MM-DD format.");
  const [year, month, day] = value.split("-").map(Number);
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) {
    invalid("Choose a valid calendar date.");
  }
  // IST is UTC+05:30 with no daylight saving, so one fixed offset is exact.
  return new Date(utc - 5 * 3_600_000 - 30 * 60_000);
}

function optionalDate(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") invalid(`${label} date is invalid.`);
  return value.trim();
}

/** Hostile or partial ranges fail closed before any database work happens. */
export function normalizeMerchantRevenueRange(fromInput: unknown, toInput: unknown): MerchantRevenueRange {
  const fromLabel = optionalDate(fromInput, "From");
  const toLabel = optionalDate(toInput, "To");
  if (!fromLabel && !toLabel) return { fromDate: null, toExclusive: null, fromLabel: null, toLabel: null };
  if (!fromLabel || !toLabel) invalid("Choose both a start and an end date.");

  const fromDate = startOfIndiaDay(fromLabel);
  const toDate = startOfIndiaDay(toLabel);
  if (fromDate.getTime() > toDate.getTime()) invalid("The start date must be on or before the end date.");
  // Add 24h rather than mutating the IST calendar date; UTC+05:30 never shifts.
  return { fromDate, toExclusive: new Date(toDate.getTime() + 86_400_000), fromLabel, toLabel };
}

export function merchantRevenueDto(
  range: MerchantRevenueRange,
  totals: { grossSales: number; netPaid: number; completedOrders: number; paidSettlements: number },
): MerchantRevenueSummary {
  return {
    from: range.fromLabel,
    to: range.toLabel,
    grossSales: Math.max(0, Math.trunc(totals.grossSales)),
    netPaid: Math.trunc(totals.netPaid),
    completedOrders: Math.max(0, Math.trunc(totals.completedOrders)),
    paidSettlements: Math.max(0, Math.trunc(totals.paidSettlements)),
    currency: "INR",
  };
}
