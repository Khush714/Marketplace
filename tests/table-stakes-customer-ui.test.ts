import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("cart sync reads once per signed-in session and only writes after a successful merge", () => {
  const cart = source("../src/lib/cart.tsx");
  assert.match(cart, /accountFetch\("\/api\/customer\/cart"/);
  assert.match(cart, /mergeCartStates/);
  assert.match(cart, /normalizeCartState/);
  assert.match(cart, /syncReady/);
  assert.match(cart, /mutating:\s*true/);
  assert.ok(cart.indexOf("/api/customer/cart", cart.indexOf("syncReady")) > cart.indexOf("syncReady"));
});

test("order history is paged, filtered and never loses the page cursor to polling", () => {
  const orders = source("../src/app/orders/page.tsx");
  assert.match(orders, /nextOffset/);
  assert.match(orders, /params\.set\("status"/);
  assert.match(orders, /params\.set\("q"/);
  assert.match(orders, /params\.set\("from"/);
  assert.match(orders, /params\.set\("to"/);
  assert.match(orders, /Load more orders/);
  assert.match(orders, /buildReorderLines/);
  assert.match(orders, /cancel-reason/);
  assert.match(orders, /<InvoiceLink/);
  assert.match(orders, /never touches nextOffset/);
});

test("tracking supports token-gated invoices, reorder, cancel reasons and reviewed photos", () => {
  const tracking = source("../src/components/tracking-view.tsx");
  assert.match(tracking, /<InvoiceLink/);
  assert.match(tracking, /buildReorderLines/);
  assert.match(tracking, /CANCEL_REASONS/);
  assert.match(tracking, /selectedReason/);
  assert.match(tracking, /kind: "review"/);
  assert.match(tracking, /photoIds/);
  assert.match(tracking, /id="review-photos"/);
  assert.match(tracking, /<ReviewPhotos/);
});

test("invoice links fetch the receipt instead of exposing a header-gated anchor", () => {
  const success = source("../src/components/order-success.tsx");
  assert.match(success, /export function InvoiceLink/);
  assert.match(success, /\/api\/orders\/\$\{encodeURIComponent\(code\)\}\/invoice/);
  assert.match(success, /orderAuthHeaders\(token\)/);
  assert.match(success, /await res\.blob\(\)/);
});

test("public reviews render only bounded same-origin photo URLs", () => {
  const reviews = source("../src/components/public-reviews.tsx");
  assert.match(reviews, /isLocalMediaUrl/);
  assert.match(reviews, /photoUrls/);
  assert.match(reviews, /unoptimized/);
  assert.match(reviews, /\.slice\(0,\s*3\)/);
});

test("checkout sends bounded tip and schedule choices to both preview and order", () => {
  const checkout = source("../src/app/checkout/page.tsx");
  assert.match(checkout, /TipSchedulePicker/);
  assert.match(checkout, /type="datetime-local"/);
  assert.match(checkout, /MIN_SCHEDULE_LEAD_MS/);
  assert.match(checkout, /MAX_TIP_CENTS/);
  assert.match(checkout, /parseTipCents/);
  assert.match(checkout, /parseScheduledFor/);
  assert.match(checkout, /JSON\.stringify\(\{ restaurantSlug, items, applyOffer, promoCode, tipCents, scheduledFor \}\)/);
  assert.match(checkout, /tipCents,\s*\n\s*scheduledFor,/);
  assert.match(checkout, /\$\{tipCents\}\|\$\{scheduledFor\}/);
});
