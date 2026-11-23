/**
 * The final bill shown at checkout must include the delivery fee, sourced from
 * the authoritative preview (with a client estimate as the pre-fetch fallback),
 * so the line item and the charged total cannot disagree.
 *
 * Run with: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  billFor,
  DELIVERY_FEE_CENTS,
  DELIVERY_FREE_ABOVE_CENTS,
  estimateBill,
  PLATFORM_FEE_CENTS,
} from "../src/lib/domain";

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

test("authoritative bill includes the delivery fee in the charged total", () => {
  const paid = billFor(30_000, 0, 0);
  assert.equal(paid.deliveryFeeCents, DELIVERY_FEE_CENTS);
  assert.equal(
    paid.totalCents,
    paid.subtotalCents + paid.deliveryFeeCents + paid.platformFeeCents - paid.discountCents,
  );

  const free = billFor(DELIVERY_FREE_ABOVE_CENTS, 0, 0);
  assert.equal(free.deliveryFeeCents, 0);
  assert.equal(free.totalCents, DELIVERY_FREE_ABOVE_CENTS + PLATFORM_FEE_CENTS);
  assert.equal(estimateBill(DELIVERY_FREE_ABOVE_CENTS).deliveryFee, 0);
});

test("checkout final bill renders a delivery fee line from the bill/estimate", () => {
  const checkout = readSource("src/app/checkout/page.tsx");

  // The itemized breakdown is fed by the authoritative bill, falling back to
  // the client estimate while the preview is in flight.
  assert.match(checkout, /deliveryFeeCents=\{bill\?\.deliveryFeeCents \?\? estimate\.deliveryFee\}/);
  assert.match(checkout, /platformFeeCents=\{bill\?\.platformFeeCents \?\? estimate\.platformFee\}/);
  assert.match(checkout, /subtotalCents=\{bill\?\.subtotalCents \?\? activeSubtotalCents\}/);

  // Not just a bare total: the delivery fee is a visible line item with the
  // free-delivery case handled, and the total still matches the bill.
  assert.match(checkout, /Delivery fee/);
  assert.match(checkout, /deliveryFeeCents === 0 \? \(\s*<span className="text-mint-400">FREE<\/span>/);
  assert.match(checkout, /cents=\{totalCents\}/);
  assert.match(checkout, /const totalCents = bill\?\.totalCents \?\? estimate\.total/);
});
