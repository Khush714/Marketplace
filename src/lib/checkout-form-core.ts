export interface CheckoutContactInput {
  name: string;
  phone: string;
  addressText: string;
}

export interface CheckoutIssueInput {
  detailsComplete: boolean;
  acceptedTerms: boolean;
  promoError: string | null;
  /** The authoritative preview was refused or never arrived; never charge blind. */
  billError?: string | null;
  hasBillableItems: boolean;
}

export type CheckoutIssue = "details" | "terms" | "promo" | "bill" | "soldOut" | null;

export const CHECKOUT_ISSUE_MESSAGES: Record<Exclude<CheckoutIssue, null>, string> = {
  details: "Add a delivery address, your name and a 10-digit mobile number to continue.",
  terms: "Accept the Terms & Privacy Policy to continue.",
  promo: "Fix or remove the offer code to continue.",
  bill: "We couldn't calculate the final bill. Please try again.",
  soldOut: "Your cart is sold out — add an available dish to continue.",
};

/** A cart line as sent to the bill/order endpoints (client metadata excluded). */
export interface CheckoutBillLine {
  menuItemId: number;
  quantity: number;
  priceCents?: number;
  modifiers?: { optionId: number; quantity: number }[];
}

/**
 * The offer selection and the exact cart it was priced against.
 *
 * Checkout keeps only the preview whose key matches this value. A late reply to
 * an older request can no longer reinstate a total from a cart or offer the
 * customer has since changed.
 */
export function checkoutBillKey({
  restaurantSlug,
  items,
  applyOffer,
  promoCode,
}: {
  restaurantSlug: string;
  items: CheckoutBillLine[];
  applyOffer: boolean;
  promoCode: string;
}): string {
  return JSON.stringify({ restaurantSlug, items, applyOffer, promoCode });
}

/** Accept a preview only when it was requested for the current selection. */
export function previewForSelection<T>(
  preview: T | null,
  previewKey: string | undefined,
  selectionKey: string,
): T | null {
  return preview !== null && previewKey === selectionKey ? preview : null;
}

export function checkoutPhoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function checkoutContactComplete({
  name,
  phone,
  addressText,
}: CheckoutContactInput): boolean {
  return (
    name.trim().length > 0 &&
    checkoutPhoneDigits(phone).length >= 10 &&
    addressText.trim().length > 10
  );
}

export function checkoutIssue({
  detailsComplete,
  acceptedTerms,
  promoError,
  billError,
  hasBillableItems,
}: CheckoutIssueInput): CheckoutIssue {
  if (!detailsComplete) return "details";
  if (!acceptedTerms) return "terms";
  if (promoError) return "promo";
  if (billError) return "bill";
  if (!hasBillableItems) return "soldOut";
  return null;
}

export function checkoutIssueMessage(issue: CheckoutIssue, billDetail?: string | null): string | null {
  if (!issue) return null;
  // A refused preview usually carries a specific, actionable server reason —
  // "this kitchen is closed", "only 2 left", and so on. Hiding that behind the
  // generic retry copy makes a legitimate refusal look like a calc bug.
  if (issue === "bill" && billDetail) return billDetail;
  return CHECKOUT_ISSUE_MESSAGES[issue];
}
