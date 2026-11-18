/**
 * Restaurant offers are opt-in: a customer must explicitly select one. The
 * authoritative bill, its preview and the stored order all use the same flag,
 * and no client-supplied value other than a literal `true` may opt in.
 *
 * Run with: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { billFor, DELIVERY_FEE_CENTS, PLATFORM_FEE_CENTS } from "../src/lib/domain";
import { validateCheckout } from "../src/lib/order-input-core";

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function checkoutBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    restaurantSlug: "ember-and-oak",
    items: [{ menuItemId: 12, quantity: 2 }],
    addressText: "12 Example Street",
    customerName: "A Customer",
    phone: "9876543210",
    paymentMethod: "cod",
    acceptedTerms: true,
    ...overrides,
  };
}

test("billFor applies no restaurant offer unless the customer selects it", () => {
  const subtotal = 30_000; // below the free-delivery threshold
  const undiscounted = billFor(subtotal, 50, 12_000);
  assert.equal(undiscounted.discountCents, 0);
  assert.equal(undiscounted.totalCents, subtotal + DELIVERY_FEE_CENTS + PLATFORM_FEE_CENTS);

  const selected = billFor(subtotal, 50, 12_000, true);
  assert.equal(selected.discountCents, 12_000, "50% capped at ₹120");
  assert.equal(selected.totalCents, subtotal - 12_000 + DELIVERY_FEE_CENTS + PLATFORM_FEE_CENTS);
});

test("billFor honours an explicit no-selection and the flat-offer threshold", () => {
  assert.equal(billFor(60_000, 50, 12_000, false).discountCents, 0, "explicit false stays undiscounted");

  // Flat offers are advertised as "above ₹X": at ₹500 the ₹150 offer applies,
  // at ₹400 it does not — but only when the customer selected it.
  assert.equal(billFor(50_000, 0, 15_000, true).discountCents, 15_000);
  assert.equal(billFor(40_000, 0, 15_000, true).discountCents, 0);
  assert.equal(billFor(50_000, 0, 15_000).discountCents, 0);
});

test("checkout whitelist keeps applyOffer as a literal opt-in", () => {
  const selected = validateCheckout(checkoutBody({ applyOffer: true }));
  assert.ok(selected.ok);
  if (selected.ok) assert.equal(selected.request.applyOffer, true);

  for (const value of [undefined, false, "true", 1, { yes: true }]) {
    const result = validateCheckout(checkoutBody({ applyOffer: value }));
    assert.ok(result.ok);
    if (result.ok) assert.equal("applyOffer" in result.request, false, `${String(value)} must not opt in`);
  }
});

test("offer selection reaches billFor through both pricing paths", () => {
  const queries = readSource("src/db/queries.ts");
  assert.match(queries, /async function computeBill\(\s*restaurantSlug: string,\s*items: CartLineSubmit\[\],\s*applyOffer = false,/);
  assert.match(queries, /billFor\(subtotal, r\.offerPercent, r\.offerMaxCents, applyOffer\)/);
  assert.match(queries, /computeBill\(input\.restaurantSlug, input\.items, input\.applyOffer === true\)/);
  assert.match(queries, /applyOffer\?: boolean/);

  const preview = readSource("src/app/api/orders/bill/route.ts");
  assert.match(preview, /computeBill\(restaurantSlug, cart\.items, body\?\.applyOffer === true\)/);

  const checkout = readSource("src/app/checkout/page.tsx");
  assert.match(checkout, /postBill\(cart\.restaurantSlug, cartLines\(cart\.items\), applyOffer\)/);
  assert.match(checkout, /^\s*applyOffer,$/m, "the place-order request must carry the selection");
});

test("no customer-facing copy still claims offers are automatic", () => {
  for (const path of [
    "src/app/cart/page.tsx",
    "src/app/restaurants/[slug]/page.tsx",
    "src/app/terms/page.tsx",
    "src/app/refunds/page.tsx",
  ]) {
    assert.doesNotMatch(readSource(path), /auto-applied|automatically applied/i, `${path} still advertises auto-applied offers`);
  }
});
