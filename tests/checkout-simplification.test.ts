/**
 * M4: checkout is shorter, but the gates behind the single CTA are not.
 * The pure core owns the visible blocker; the page still sends only customer
 * selections and lets /api/orders recompute every money field.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  checkoutContactComplete,
  checkoutIssue,
  checkoutIssueMessage,
  checkoutPhoneDigits,
} from "../src/lib/checkout-form-core";

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const CHECKOUT = readSource("src/app/checkout/page.tsx");

const complete = {
  detailsComplete: true,
  acceptedTerms: true,
  promoError: null,
  hasBillableItems: true,
};

test("contact completeness keeps the name, phone and address thresholds", () => {
  const valid = { name: " Asha ", phone: "+91 98765 43210", addressText: "12 Station Road, Bharuch" };
  assert.equal(checkoutPhoneDigits(valid.phone), "919876543210");
  assert.equal(checkoutContactComplete(valid), true);

  assert.equal(checkoutContactComplete({ ...valid, name: "  " }), false);
  assert.equal(checkoutContactComplete({ ...valid, phone: "987654321" }), false);
  assert.equal(checkoutContactComplete({ ...valid, addressText: "Short" }), false);
});

test("the visible blocker is reported in a stable priority order", () => {
  assert.equal(checkoutIssue({ ...complete, detailsComplete: false }), "details");
  assert.equal(checkoutIssue({ ...complete, acceptedTerms: false }), "terms");
  assert.equal(checkoutIssue({ ...complete, promoError: "Offer expired" }), "promo");
  assert.equal(checkoutIssue({ ...complete, hasBillableItems: false }), "soldOut");
  assert.equal(checkoutIssue(complete), null);

  assert.equal(
    checkoutIssue({ ...complete, billError: "Bill unavailable" }),
    "bill",
    "an order must never be placed on the optimistic fallback",
  );

  for (const issue of ["details", "terms", "promo", "bill", "soldOut"] as const) {
    assert.ok(checkoutIssueMessage(issue), `${issue} must tell the customer how to continue`);
  }
  assert.equal(checkoutIssueMessage(null), null);
  assert.equal(
    checkoutIssueMessage("bill", "Verde Kitchen is peak hours"),
    "Verde Kitchen is peak hours",
    "a refused preview must show the server's actual reason, not generic retry copy",
  );
});

test("checkout has two required cards and one optional disclosure", () => {
  assert.match(CHECKOUT, /<Section title="Delivery details" Icon={MapPin}>/);
  assert.match(CHECKOUT, /<Section title="Payment" Icon={CreditCard}>/);
  assert.doesNotMatch(CHECKOUT, /step=\{[1-5]\}/);
  assert.match(CHECKOUT, /Offers &amp; delivery note/);
  assert.match(CHECKOUT, /aria-expanded=\{showExtras\}/);
  assert.match(CHECKOUT, /aria-controls="checkout-extras"/);
  assert.match(CHECKOUT, /id="checkout-extras"/);
  assert.match(CHECKOUT, /Delivery note \(optional\)/);
});

test("the page consumes the pure blocker instead of duplicating validation", () => {
  assert.match(CHECKOUT, /checkoutContactComplete\(\{/);
  assert.match(CHECKOUT, /checkoutIssue\(\{ detailsComplete, acceptedTerms, promoError, billError, hasBillableItems \}\)/);
  assert.match(CHECKOUT, /checkoutIssueMessage\(/);
  assert.match(CHECKOUT, /!billError && hasBillableItems && !!bill/);
});

test("mobile keeps a single sticky CTA inside the safe area", () => {
  assert.match(CHECKOUT, /data-checkout-cta=""/);
  assert.match(CHECKOUT, /className="mt-4 hidden lg:flex"/);
  assert.match(CHECKOUT, /backdrop-blur-xl lg:hidden/);
  assert.match(CHECKOUT, /paddingBottom: "max\(1rem, env\(safe-area-inset-bottom\)\)"/);
  // The global route animation transforms its wrapper, so a descendant `fixed`
  // bar pins to that wrapper instead of the viewport. The portal is load-bearing.
  assert.match(CHECKOUT, /createPortal\(/);
  assert.match(CHECKOUT, /useEffect\(\(\) => setPortalHost\(document\.body\), \[\]\)/);
});

test("simplification does not move money or consent into the browser", () => {
  assert.match(CHECKOUT, /postBill\(cart\.restaurantSlug, cartPayload, applyOffer, promoCode\)/);

  const orderRequest = CHECKOUT.slice(
    CHECKOUT.indexOf('fetch("/api/orders"'),
    CHECKOUT.indexOf("const raw = await res.text();"),
  );
  assert.ok(orderRequest.length > 0);
  assert.match(orderRequest, /acceptedTerms,/);
  assert.match(orderRequest, /localityKey: currentLocalityKey\(\),/);
  assert.doesNotMatch(orderRequest, /\btotalCents\s*:/);
  assert.doesNotMatch(orderRequest, /\bsubtotalCents\s*:/);
  assert.doesNotMatch(orderRequest, /\bpaymentMethod:\s*choice\s*\?\s*"/);
});
