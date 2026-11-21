/**
 * Tests for checkout input validation (`order-input-core.ts`) and the wiring of
 * the two routes that consume it.
 *
 * Run with: npm test
 *
 * Pricing was always server-side — `computeBill` resolves every line from the
 * menu row and `createOrder` stores only that bill — but the request around it
 * was loose in three ways worth pinning:
 *
 *   - Quantity and cart size were unenforced (or silently clamped), so the
 *     number the customer submitted and the number billed could differ.
 *   - `paymentMethod` was an arbitrary string: anything `isOnlinePayment`
 *     did not recognise was treated as cash and stored verbatim.
 *   - The parsed body was forwarded to `createOrder` as received, so nothing
 *     checked that client-supplied price/restaurant fields were absent — trust
 *     rested on them being ignored.
 *
 * The route itself cannot be executed under `node --test` (it imports
 * `server-only` and the database), so the wiring assertions read the source the
 * same way `abuse-guards.test.ts` does: what matters is that validation runs
 * between the body read and the write, and that the input `createOrder`
 * receives is the rebuilt one.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CHECKOUT_PAYMENT_METHODS,
  MAX_ADDRESS_TEXT,
  MAX_CART_ITEMS,
  MAX_CUSTOMER_NAME,
  MAX_INSTRUCTIONS,
  MAX_ITEM_QUANTITY,
  MAX_RESTAURANT_SLUG,
  checkoutPaymentMethod,
  quantityIsValid,
  sanitizeCart,
  validateCheckout,
} from "../src/lib/order-input-core";

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

/** A well-formed checkout body; per-test fields are overridden as needed. */
function checkoutBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    restaurantSlug: "  pasta-palace  ",
    items: [{ menuItemId: 12, quantity: 2, priceCents: 25000 }],
    addressLabel: "  Office  ",
    addressText: "221B Baker Street",
    customerName: "  Asha Rao  ",
    phone: "+91 98765 43210",
    paymentMethod: "UPI",
    instructions: "Ring twice",
    clientRequestId: "  attempt-1  ",
    outletId: "  outlet-9  ",
    acceptedTerms: true,
    // Client-priced fields. None of these may survive validation.
    total: 99999,
    subtotal: 1,
    discount: 2,
    deliveryFee: 3,
    price: 4,
    restaurantName: "Evil Corp",
    ...overrides,
  };
}

/* --------------------------------- bounds --------------------------------- */

test("the checkout bounds are the documented ones", () => {
  assert.equal(MAX_ITEM_QUANTITY, 99);
  assert.equal(MAX_CART_ITEMS, 50);
  assert.equal(MAX_CUSTOMER_NAME, 80);
  assert.equal(MAX_ADDRESS_TEXT, 500);
  assert.equal(MAX_INSTRUCTIONS, 500);
  assert.equal(MAX_RESTAURANT_SLUG, 120);
  assert.deepEqual([...CHECKOUT_PAYMENT_METHODS], ["upi", "card", "cod"]);
});

/* ----------------------------- payment methods ---------------------------- */

test("payment methods are matched against the allowlist, case-insensitively", () => {
  assert.equal(checkoutPaymentMethod("upi"), "upi");
  assert.equal(checkoutPaymentMethod("card"), "card");
  assert.equal(checkoutPaymentMethod("cod"), "cod");
  assert.equal(checkoutPaymentMethod("  UPI  "), "upi");
  assert.equal(checkoutPaymentMethod("Cod"), "cod");
});

test("a payment method outside the allowlist is null, not a guess", () => {
  // netbanking/wallet are recognised by isOnlinePayment; anything else was
  // previously treated as cash and stored verbatim at the POS.
  for (const raw of ["netbanking", "wallet", "paypal", "cash", "", "  ", "upi2"]) {
    assert.equal(checkoutPaymentMethod(raw), null, `${JSON.stringify(raw)} must be rejected`);
  }
  for (const raw of [null, undefined, 42, true, {}, []]) {
    assert.equal(checkoutPaymentMethod(raw), null, `${String(raw)} must be rejected`);
  }
});

/* -------------------------------- quantities ------------------------------ */

test("a quantity is an integer within 1..MAX_ITEM_QUANTITY", () => {
  for (const raw of [1, 99, 50, "5", " 7 ", 3.0]) {
    assert.ok(quantityIsValid(raw), `${JSON.stringify(raw)} should be valid`);
  }
  for (const raw of [0, -1, 100, 1000, 1.5, "3.5", "", "  ", "abc", null, undefined, NaN, true, {}, []]) {
    assert.ok(!quantityIsValid(raw), `${JSON.stringify(raw)} should be rejected`);
  }
});

/* -------------------------------- cart lines ------------------------------ */

test("sanitizeCart keeps only the fields it validated", () => {
  const result = sanitizeCart([
    {
      menuItemId: "12",
      quantity: "3",
      priceCents: 25000,
      modifiers: [{ optionId: 7, quantity: 2, sneaky: "x" }, { optionId: "oops" }, null],
      restaurantName: "Evil Corp",
      total: 1,
    },
  ]);
  assert.ok(result.ok);
  assert.deepEqual(result.items, [
    {
      menuItemId: 12,
      quantity: 3,
      priceCents: 25000,
      modifiers: [{ optionId: 7, quantity: 2 }],
    },
  ]);
  assert.equal("restaurantName" in result.items[0], false);
  assert.equal("total" in result.items[0], false);
});

test("an empty or absent cart is EMPTY_CART", () => {
  for (const raw of [[], undefined, null, "items", 42]) {
    const result = sanitizeCart(raw);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "EMPTY_CART");
  }
});

test("an out-of-range quantity rejects the whole cart, with the bound in the message", () => {
  for (const quantity of [0, -3, MAX_ITEM_QUANTITY + 1, 1.5]) {
    const result = sanitizeCart([{ menuItemId: 1, quantity: 1 }, { menuItemId: 2, quantity }]);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "QUANTITY_OUT_OF_RANGE");
      assert.match(result.error, /between 1 and 99/);
    }
  }
});

test("a malformed line rejects the whole cart rather than being dropped", () => {
  // The old bill preview silently filtered bad lines out, which meant the
  // preview could disagree with the order it claimed to preview.
  for (const line of [
    { quantity: 2 },
    { menuItemId: "twelve", quantity: 2 },
    { menuItemId: 0, quantity: 2 },
    { menuItemId: -1, quantity: 2 },
    { menuItemId: 1.5, quantity: 2 },
    "junk",
    null,
  ]) {
    const result = sanitizeCart([{ menuItemId: 1, quantity: 1 }, line]);
    assert.equal(result.ok, false, `${JSON.stringify(line)} should be rejected`);
    if (!result.ok) assert.equal(result.code, "MISSING_FIELDS");
  }
});

test("carts beyond MAX_CART_ITEMS distinct items are rejected, duplicates counted once", () => {
  const line = (id: number) => ({ menuItemId: id, quantity: 1 });
  assert.ok(sanitizeCart(Array.from({ length: MAX_CART_ITEMS }, (_, i) => line(i + 1))).ok);

  const tooMany = sanitizeCart(Array.from({ length: MAX_CART_ITEMS + 1 }, (_, i) => line(i + 1)));
  assert.equal(tooMany.ok, false);
  if (!tooMany.ok) assert.equal(tooMany.code, "CART_TOO_LARGE");

  // 60 lines that all resolve to the same 50 items still pass: the limit is on
  // distinct items (the `inArray` lookup), not on lines.
  const doubled = Array.from({ length: MAX_CART_ITEMS * 2 }, (_, i) => line((i % MAX_CART_ITEMS) + 1));
  assert.ok(sanitizeCart(doubled).ok);
});

/* ------------------------------- checkout --------------------------------- */

test("validateCheckout normalizes its fields and rebuilds the input from a whitelist", () => {
  const result = validateCheckout(checkoutBody());
  assert.ok(result.ok, result.ok ? "" : result.error);
  if (!result.ok) return;

  const req = result.request;
  assert.equal(req.restaurantSlug, "pasta-palace");
  assert.equal(req.customerName, "Asha Rao");
  assert.equal(req.addressLabel, "Office");
  assert.equal(req.phone, "9876543210", "phone is digits only, last 10");
  assert.equal(req.paymentMethod, "upi");
  assert.equal(req.clientRequestId, "attempt-1");
  assert.equal(req.outletId, "outlet-9");

  // The client-priced fields were never carried into the request at all.
  for (const field of ["total", "subtotal", "discount", "deliveryFee", "price", "restaurantName"]) {
    assert.equal(field in req, false, `${field} must not survive validation`);
  }
});

test("validateCheckout rejects a request missing any required field", () => {
  const cases: Record<string, unknown> = {
    restaurantSlug: "   ",
    customerName: "",
    addressText: undefined,
    phone: "12345",
  };
  for (const [field, value] of Object.entries(cases)) {
    const result = validateCheckout(checkoutBody({ [field]: value }));
    assert.equal(result.ok, false, `${field}=${JSON.stringify(value)} should be rejected`);
    if (!result.ok) assert.equal(result.code, "MISSING_FIELDS");
  }
});

test("validateCheckout surfaces the cart and payment rejections with their codes", () => {
  const empty = validateCheckout(checkoutBody({ items: [] }));
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.code, "EMPTY_CART");

  const qty = validateCheckout(checkoutBody({ items: [{ menuItemId: 1, quantity: 100 }] }));
  assert.equal(qty.ok, false);
  if (!qty.ok) assert.equal(qty.code, "QUANTITY_OUT_OF_RANGE");

  const pay = validateCheckout(checkoutBody({ paymentMethod: "netbanking" }));
  assert.equal(pay.ok, false);
  if (!pay.ok) {
    assert.equal(pay.code, "PAYMENT_METHOD_NOT_ALLOWED");
    assert.match(pay.error, /UPI, card or cash on delivery/);
  }
});

test("validateCheckout bounds the fields it trims so a body cannot park a blob in a text column", () => {
  const result = validateCheckout(
    checkoutBody({
      clientRequestId: "x".repeat(200),
      outletId: "y".repeat(200),
      addressLabel: "z".repeat(200),
    }),
  );
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.request.clientRequestId?.length, 80);
  assert.equal(result.request.outletId?.length, 64);
  assert.equal(result.request.addressLabel?.length, 80);
});

test("the free-text fields are bounded, so a body cannot park a blob in a text column", () => {
  // The JSON body cap bounds the aggregate, not any single field: before these
  // bounds an order row could carry a megabyte of `customerName`, and the same
  // string is forwarded to the POS on delivery.
  const result = validateCheckout(
    checkoutBody({
      customerName: "N".repeat(5_000),
      addressText: "A".repeat(9_000),
      instructions: "I".repeat(9_000),
      restaurantSlug: "p".repeat(500),
    }),
  );
  assert.ok(result.ok, result.ok ? "" : result.error);
  if (!result.ok) return;
  assert.equal(result.request.customerName.length, MAX_CUSTOMER_NAME);
  assert.equal(result.request.addressText.length, MAX_ADDRESS_TEXT);
  assert.equal(result.request.instructions?.length, MAX_INSTRUCTIONS);
  assert.equal(result.request.restaurantSlug.length, MAX_RESTAURANT_SLUG);
});

test("blank instructions are dropped rather than stored as an empty string", () => {
  const result = validateCheckout(checkoutBody({ instructions: "   " }));
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal("instructions" in result.request, false);
});

test("consent is enforced by the server, not only by the checkbox", () => {
  // `canPlace` in checkout/page.tsx decides whether the button lights up; this
  // decides whether the order exists. A POST straight to /api/orders must not be
  // able to skip the gate the UI applies.
  for (const value of [undefined, null, false, "true", "yes", 1, {}]) {
    const result = validateCheckout(checkoutBody({ acceptedTerms: value }));
    assert.equal(result.ok, false, `${JSON.stringify(value)} must not pass`);
    if (!result.ok) assert.equal(result.code, "TERMS_NOT_ACCEPTED");
  }
  assert.ok(validateCheckout(checkoutBody({ acceptedTerms: true })).ok);
});

test("the shipped checkout form sends the consent flag the server checks", () => {
  const source = readSource("src/app/checkout/page.tsx");
  assert.match(source, /acceptedTerms,\n?\s*\}\)/);
  // The consent state is read by the request, not merely by the button.
  assert.match(source, /canPlace = detailsComplete && acceptedTerms/);
});

test("an address label the client never sent falls back to the row default", () => {
  const result = validateCheckout(checkoutBody({ addressLabel: "   " }));
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal("addressLabel" in result.request, false, "absent label must stay absent, not ''");
});

/* ----------------------------- route wiring ------------------------------- */

test("POST /api/orders validates the body and passes the rebuilt input to createOrder", () => {
  const source = readSource("src/app/api/orders/route.ts");

  assert.match(source, /validateCheckout\(parsed\.body\)/);
  assert.match(source, /createOrder\(validated\.request\)/);
  assert.doesNotMatch(source, /createOrder\(body/);
  // The old "parse, cast and forward" path — and any read of a client-priced
  // field off the raw body — must be gone.
  assert.doesNotMatch(source, /\bbody as CreateOrderInput\b/);
  assert.doesNotMatch(
    source,
    /\bbody\.(total|subtotal|discount|deliveryFee|price|restaurantName|items|paymentMethod|phone)\b/,
  );

  // Validation runs between the body read and the write, behind the budget.
  const guardAt = source.search(/\bguardWrite\(/);
  const validateAt = source.search(/validateCheckout\(/);
  const writeAt = source.search(/await createOrder\(/);
  assert.ok(guardAt >= 0 && validateAt > guardAt, "the guard must run before the body is validated");
  assert.ok(writeAt > validateAt, "the body must be validated before the order is written");
});

test("the clamp inside computeBill uses the same bound the routes enforce", () => {
  const source = readSource("src/db/queries.ts");
  assert.match(source, /import \{ MAX_ITEM_QUANTITY \} from "@\/lib\/order-input-core";/);
  assert.match(source, /Math\.min\(MAX_ITEM_QUANTITY, Math\.max\(1, Math\.floor\(item\.quantity\) \|\| 1\)\)/);
  // The old clamp billed a quantity of 50 as 20 — accepted, then rewritten.
  assert.doesNotMatch(source, /Math\.min\(20,/);
});

test("the bill preview enforces the same cart rules as checkout", () => {
  const source = readSource("src/app/api/orders/bill/route.ts");
  assert.match(source, /import \{ sanitizeCart \} from "@\/lib\/order-input-core";/);
  const sanitizeAt = source.search(/sanitizeCart\(/);
  const billAt = source.search(/await computeBill\(/);
  assert.ok(sanitizeAt > 0 && billAt > sanitizeAt, "the cart must be sanitized before it is priced");
  assert.match(source, /guardWrite\(req, "billPreview"\)/);
});

test("the shipped checkout form only ever sends allowlisted payment methods", () => {
  const source = readSource("src/app/checkout/page.tsx");
  assert.match(source, /paymentMethod: choice === "online" \? "upi" : "cod",/);
});
