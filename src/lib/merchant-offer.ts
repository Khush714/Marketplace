/**
 * Pure validation and DTO mapping for the Marketplace-owned promotion library.
 *
 * Kept free of `server-only` imports so the rules can be asserted directly in
 * tests. The Merchant App sends the same shape its own editor uses; validating
 * again here is deliberate — the Marketplace is authoritative, so a modified
 * client must never be able to store a malformed or out-of-range promotion.
 */

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

type MerchantOfferRow = {
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

/** DTO consumed directly by the Merchant App's Offers screen. */
export function merchantOfferDto(row: MerchantOfferRow, businessId: string) {
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
    // Marketplace orders record the listing's discount but not a promo-code
    // reference yet, so per-code attribution is not fabricated here.
    redemptions: 0,
    discountGiven: 0,
    influencedGross: 0,
  };
}
