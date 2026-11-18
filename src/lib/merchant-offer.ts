/**
 * Pure validation and DTO mapping for the Marketplace-owned promotion library.
 *
 * Kept free of `server-only` imports so the rules can be asserted directly in
 * tests. The Merchant App sends the same shape its own editor uses; validating
 * again here is deliberate — the Marketplace is authoritative, so a modified
 * client must never be able to store a malformed or out-of-range promotion.
 *
 * The customer-facing half of this module is equally important: the codes shown
 * on a listing and accepted at checkout are the very same rows, and the discount
 * is recalculated from them on the server. A browser may propose a code, never
 * a discount amount.
 */

import { formatINR, type BillBreakdown } from "./domain";

export type MerchantOfferInput = {
  code: string;
  title: string;
  description: string;
  discountType: "percent" | "flat";
  value: number;
  minOrder: number;
  maxDiscount: number | null;
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  active: boolean;
};

export type MerchantOfferRow = {
  id: string;
  code: string;
  title: string;
  description: string;
  discountType: string;
  value: number;
  minOrder: number;
  maxDiscount: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  active: boolean;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type MerchantOfferIssue =
  | "OFFER_UNAVAILABLE"
  | "OFFER_NOT_STARTED"
  | "OFFER_ENDED"
  | "OFFER_EXHAUSTED";

export type MerchantOfferErrorCode = MerchantOfferIssue | "MIN_ORDER_NOT_MET" | "INVALID_PROMO_CODE";

export type MerchantOfferEvaluation =
  | { ok: true; discountCents: number }
  | { ok: false; code: MerchantOfferErrorCode; error: string };

export interface PublicMerchantOffer {
  id: string;
  code: string;
  title: string;
  description: string;
  discountType: "percent" | "flat";
  value: number;
  /** Ready-made customer copy, e.g. "20% off" or "₹100 off". */
  discountLabel: string;
  minOrderCents: number;
  maxDiscountCents: number | null;
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  redemptions: number;
  remainingUses: number | null;
  /** Schedule and usage only; cart-size eligibility is checked at checkout. */
  available: boolean;
  unavailableReason: string | null;
}

const CODE_PATTERN = /^[A-Z0-9_-]{3,40}$/;

function optionalDate(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error(`Invalid ${label.toLowerCase()}.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid ${label.toLowerCase()}.`);
  return parsed.toISOString();
}

export function parseMerchantOfferInput(body: Record<string, unknown>): MerchantOfferInput {
  const code = String(body.code ?? "").trim().toUpperCase();
  const title = String(body.title ?? "").trim();
  const description = String(body.description ?? "").trim();
  const discountType = body.discountType === "flat" ? "flat" : "percent";
  const value = Number(body.value);
  const minOrder = body.minOrder === undefined || body.minOrder === null || body.minOrder === "" ? 0 : Number(body.minOrder);
  const maxDiscount = body.maxDiscount === undefined || body.maxDiscount === null || body.maxDiscount === "" ? null : Number(body.maxDiscount);
  const usageLimit = body.usageLimit === undefined || body.usageLimit === null || body.usageLimit === "" ? null : Number(body.usageLimit);
  const active = body.active === undefined ? true : body.active === true;

  if (!CODE_PATTERN.test(code)) throw new Error("Use a code of 3–40 letters, numbers, dashes or underscores.");
  if (title.length < 2 || title.length > 80) throw new Error("Add a short offer title (2–80 characters).");
  if (description.length > 300) throw new Error("Keep the description under 300 characters.");
  if (!Number.isSafeInteger(value) || (discountType === "percent" ? value < 1 || value > 100 : value < 100 || value > 10_000_000)) {
    throw new Error(discountType === "percent" ? "Enter a discount between 1% and 100%." : "Enter a flat discount between ₹1 and ₹100,000.");
  }
  if (!Number.isSafeInteger(minOrder) || minOrder < 0 || minOrder > 10_000_000) throw new Error("Enter a valid minimum order value.");
  if (maxDiscount !== null && (!Number.isSafeInteger(maxDiscount) || maxDiscount < 100 || maxDiscount > 10_000_000)) throw new Error("Enter a valid maximum discount.");
  if (usageLimit !== null && (!Number.isSafeInteger(usageLimit) || usageLimit < 1 || usageLimit > 1_000_000)) throw new Error("Enter a valid usage limit.");
  if (typeof body.active !== "undefined" && typeof body.active !== "boolean") throw new Error("Invalid offer status.");

  const startsAt = optionalDate(body.startsAt, "Start date");
  const endsAt = optionalDate(body.endsAt, "End date");
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error("The end date must be after the start date.");

  return { code, title, description, discountType, value, minOrder, maxDiscount, startsAt, endsAt, usageLimit, active };
}

/**
 * Normalise a customer-entered code to the canonical stored form. Unlike the
 * merchant editor, a shopper is not told whether a code exists — an unusable
 * code simply never resolves to a discount.
 */
export function parseOfferCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

/** The few codes that describe why an otherwise valid offer cannot be used. */
function availabilityIssue(
  row: MerchantOfferRow,
  redemptions: number,
  now: Date,
): MerchantOfferIssue | null {
  if (!row.active || row.archived) return "OFFER_UNAVAILABLE";
  if (row.startsAt && now.getTime() < row.startsAt.getTime()) return "OFFER_NOT_STARTED";
  if (row.endsAt && now.getTime() > row.endsAt.getTime()) return "OFFER_ENDED";
  if (row.usageLimit !== null && redemptions >= row.usageLimit) return "OFFER_EXHAUSTED";
  return null;
}

function issueMessage(issue: MerchantOfferIssue): string {
  switch (issue) {
    case "OFFER_NOT_STARTED": return "This offer is not live yet.";
    case "OFFER_ENDED": return "This offer has ended.";
    case "OFFER_EXHAUSTED": return "This offer has reached its usage limit.";
    default: return "This offer is no longer available.";
  }
}

/** Integer paise off, capped by the offer's own ceiling and never below zero. */
export function merchantOfferDiscountCents(row: MerchantOfferRow, subtotalCents: number): number {
  if (!Number.isFinite(subtotalCents) || subtotalCents <= 0) return 0;
  const raw = row.discountType === "percent"
    ? Math.round((subtotalCents * row.value) / 100)
    : row.value;
  const capped = row.maxDiscount === null ? raw : Math.min(raw, row.maxDiscount);
  return Math.max(0, Math.min(capped, subtotalCents));
}

/**
 * Single eligibility decision shared by the customer API and the authoritative
 * bill. `minOrder` depends on the cart, so it is checked here rather than in the
 * display-only DTO above.
 */
export function evaluateMerchantOffer(
  row: MerchantOfferRow,
  redemptions: number,
  subtotalCents: number,
  now = new Date(),
): MerchantOfferEvaluation {
  const issue = availabilityIssue(row, redemptions, now);
  if (issue) return { ok: false, code: issue, error: issueMessage(issue) };
  if (subtotalCents < row.minOrder) {
    return {
      ok: false,
      code: "MIN_ORDER_NOT_MET",
      error: `Add ${formatINR(row.minOrder - subtotalCents)} more to use ${row.code}.`,
    };
  }
  const discountCents = merchantOfferDiscountCents(row, subtotalCents);
  if (discountCents <= 0) return { ok: false, code: "OFFER_UNAVAILABLE", error: issueMessage("OFFER_UNAVAILABLE") };
  return { ok: true, discountCents };
}

/** Re-price an authoritative bill after a merchant promo has been accepted. */
export function billWithMerchantOffer(bill: BillBreakdown, discountCents: number): BillBreakdown {
  return {
    ...bill,
    discountCents,
    totalCents: bill.subtotalCents - discountCents + bill.deliveryFeeCents + bill.platformFeeCents,
  };
}

/** Customer-safe projection: no internal ids, business ids or secrets. */
export function publicMerchantOfferDto(
  row: MerchantOfferRow,
  redemptions: number,
  now = new Date(),
): PublicMerchantOffer {
  const issue = availabilityIssue(row, redemptions, now);
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description,
    discountType: row.discountType === "flat" ? "flat" : "percent",
    value: row.value,
    discountLabel: row.discountType === "flat" ? `${formatINR(row.value)} off` : `${row.value}% off`,
    minOrderCents: row.minOrder,
    maxDiscountCents: row.maxDiscount,
    startsAt: row.startsAt ? row.startsAt.toISOString() : null,
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    usageLimit: row.usageLimit,
    redemptions,
    remainingUses: row.usageLimit === null ? null : Math.max(0, row.usageLimit - redemptions),
    available: issue === null,
    unavailableReason: issue ? issueMessage(issue) : null,
  };
}

/** DTO consumed directly by the Merchant App's Offers screen. */
export function merchantOfferDto(row: MerchantOfferRow, businessId: string, redemptions = 0) {
  return {
    id: row.id,
    businessId,
    code: row.code,
    title: row.title,
    description: row.description,
    discountType: row.discountType === "flat" ? "flat" as const : "percent" as const,
    value: row.value,
    minOrder: row.minOrder,
    maxDiscount: row.maxDiscount,
    startsAt: row.startsAt ? row.startsAt.toISOString() : null,
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    usageLimit: row.usageLimit,
    active: row.active,
    archived: row.archived,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    // Marketplace orders now stamp the chosen code, so the Merchant App can see
    // real redemptions per promotion. Revenue attribution is still not derived
    // here — that needs a full order-level report, not an offer row field.
    redemptions,
    discountGiven: 0,
    influencedGross: 0,
  };
}
