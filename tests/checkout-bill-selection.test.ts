/**
 * A checkout total must belong to the offer selection the customer just made.
 *
 * The bill endpoint is authoritative, but HTTP replies are not instantaneous:
 * a preview for the previous cart or the previous offer can land after the
 * selection changed. Every preview is therefore tagged with a key derived from
 * the exact cart + offer selection, and only the matching one may drive the
 * displayed total or the order-placement gate.
 *
 * Run with: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  checkoutBillKey,
  checkoutIssue,
  previewForSelection,
  type CheckoutBillLine,
} from "../src/lib/checkout-form-core";

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const ITEMS: CheckoutBillLine[] = [{ menuItemId: 58, quantity: 1, priceCents: 34_900 }];

test("a late bill preview from another offer selection is ignored", () => {
  const base = { restaurantSlug: "verde-kitchen", items: ITEMS, promoCode: "" };
  const plainKey = checkoutBillKey({ ...base, applyOffer: false });
  const offerKey = checkoutBillKey({ ...base, applyOffer: true });
  const codeKey = checkoutBillKey({ ...base, applyOffer: false, promoCode: "VERDE10" });

  assert.notEqual(plainKey, offerKey);
  assert.notEqual(plainKey, codeKey);
  assert.notEqual(offerKey, codeKey);

  const discounted = {
    ok: true as const,
    bill: {
      subtotalCents: 34_900,
      discountCents: 3_490,
      deliveryFeeCents: 3_900,
      platformFeeCents: 600,
      totalCents: 35_910,
    },
  };

  assert.equal(
    previewForSelection(discounted, plainKey, offerKey),
    null,
    "a discounted total priced before the selection changed must not resurface",
  );
  assert.equal(previewForSelection(discounted, offerKey, offerKey), discounted);
  assert.equal(previewForSelection(discounted, undefined, offerKey), null);
});

test("a refused or missing bill preview blocks order placement", () => {
  assert.equal(
    checkoutIssue({
      detailsComplete: true,
      acceptedTerms: true,
      promoError: null,
      billError: "That kitchen is not accepting orders right now.",
      hasBillableItems: true,
    }),
    "bill",
  );
});

test("checkout derives the visible total only from the matching preview", () => {
  const checkout = readSource("src/app/checkout/page.tsx");

  assert.match(checkout, /checkoutBillKey\(\{[\s\S]*?restaurantSlug: cart\.restaurantSlug,/);
  assert.match(checkout, /previewForSelection\(billState, billState\?\.key, selectionKey\)/);
  assert.match(checkout, /const bill = activePreview\?\.ok && activePreview\.bill \? activePreview\.bill : null/);
  assert.match(checkout, /const totalCents = bill\?\.totalCents \?\? estimate\.total/);
  assert.match(checkout, /applyPreview\(preview, selectionKey\)/);

  // No direct bill setters on the offer handlers: the selection key itself
  // invalidates the old total, so none can survive a selection change.
  assert.doesNotMatch(checkout, /setBill\(/);
  assert.doesNotMatch(checkout, /setAppliedPromo\(/);
  assert.doesNotMatch(checkout, /setOfferAvailable\(/);

  // The optimistic fallback is shown, never charged.
  assert.match(checkout, /!billError && hasBillableItems && !!bill/);
  assert.match(checkout, /billError:\s*billFailed/);
  assert.match(checkout, /checkoutIssue\(\{ detailsComplete, acceptedTerms, promoError, billError, hasBillableItems \}\)/);
  // The refused preview's reason reaches the visible blocker instead of being
  // replaced by generic retry copy.
  assert.match(checkout, /checkoutIssueMessage\(\s*checkoutIssue\([\s\S]*?\),\s*billError,\s*\)/);
});
