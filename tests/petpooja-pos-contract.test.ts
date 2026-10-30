/**
 * Petpooja provider adapter contract tests.
 *
 * Run with: npm run test:unit
 *
 * These pin the parts that cannot be allowed to drift:
 *  - money is converted from integer paise to decimal strings without float
 *    rupee arithmetic;
 *  - the snippet's status vocabulary maps onto the canonical lifecycle (and
 *    "Dispatched" does not skip the out-for-delivery stage);
 *  - the callback timestamp window fails closed;
 *  - the webhook is signature-gated, tenant-scoped, and reuses the shared
 *    transition ledger instead of writing a status column directly.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildPetpoojaOrderPayload,
  formatCentsAsRupees,
  mapPetpoojaStatus,
  normalizePetpoojaPhone,
  parsePetpoojaCallback,
  parsePetpoojaPushResponse,
  petpoojaEventId,
  petpoojaTimestampValid,
} from "../src/integrations/pos/petpooja-core";
import { integrationReadiness } from "../src/integrations/pos/readiness";

const ORDER = {
  items: [
    {
      menuItemId: 101,
      name: "Paneer Tikka",
      priceCents: 25000,
      quantity: 2,
      imageUrl: "",
      isVeg: true,
      modifiers: [{ optionId: 1, name: "Extra Cheese", priceCents: 5000, quantity: 1 }],
    },
  ],
  customerName: "Asha",
  phone: "+91 98765 43210",
  instructions: "Ring the bell",
  totalCents: 55000,
};

/* ------------------------------- money ---------------------------------- */

test("integer paise encode to fixed two-decimal rupees", () => {
  assert.equal(formatCentsAsRupees(12345), "123.45");
  assert.equal(formatCentsAsRupees(5), "0.05");
  assert.equal(formatCentsAsRupees(100), "1.00");
  assert.equal(formatCentsAsRupees(0), "0.00");
  assert.equal(formatCentsAsRupees(-250), "-2.50");
});

test("phone normalization keeps the last 10 digits", () => {
  assert.equal(normalizePetpoojaPhone("+91 98765 43210"), "9876543210");
  assert.equal(normalizePetpoojaPhone("(987) 654-3210"), "9876543210");
  assert.equal(normalizePetpoojaPhone(null), "");
});

/* ------------------------------ payload --------------------------------- */

test("the payload carries the stable external order id and restID", () => {
  const payload = buildPetpoojaOrderPayload(ORDER, {
    restId: "rest_42",
    externalOrderId: "mkt_ord_7",
  });
  assert.equal(payload.restID, "rest_42");
  assert.equal(payload.order_info.orderID, "mkt_ord_7");
  assert.equal(payload.order_info.order_type, "Delivery");
  assert.equal(payload.order_info.total_amount, "550.00");
  assert.equal(payload.order_info.customer_name, "Asha");
  assert.equal(payload.order_info.customer_phone, "9876543210");
});

test("item lines fold modifiers into the name and price the effective unit", () => {
  const payload = buildPetpoojaOrderPayload(ORDER, {
    restId: "rest_42",
    externalOrderId: "mkt_ord_7",
  });
  assert.equal(payload.order_info.items.length, 1);
  const line = payload.order_info.items[0];
  assert.equal(line.item_id, "101");
  assert.equal(line.item_name, "Paneer Tikka (Extra Cheese)");
  assert.equal(line.quantity, 2);
  // (250.00 × 2 + 50.00 modifier) / 2 = 275.00
  assert.equal(line.price, "275.00");
  assert.equal(line.special_instructions, "Ring the bell");
});

test("order instructions do not repeat on every line", () => {
  const order = {
    ...ORDER,
    items: [
      ORDER.items[0],
      { ...ORDER.items[0], menuItemId: 102, name: "Naan" },
    ],
    totalCents: 110000,
  };
  const payload = buildPetpoojaOrderPayload(order, {
    restId: "rest_42",
    externalOrderId: "mkt_ord_8",
  });
  assert.equal(payload.order_info.items[0].special_instructions, "Ring the bell");
  assert.equal(payload.order_info.items[1].special_instructions, "");
});

/* ----------------------------- status map ------------------------------- */

test("the snippet's status vocabulary maps to canonical statuses", () => {
  assert.equal(mapPetpoojaStatus("Food Being Prepared"), "PREPARING");
  assert.equal(mapPetpoojaStatus("Food Ready for Dispatch"), "READY");
  assert.equal(mapPetpoojaStatus("Cancelled"), "CANCELLED");
  assert.equal(mapPetpoojaStatus("Delivered"), "DELIVERED");
  assert.equal(mapPetpoojaStatus("Completed"), "COMPLETED");
});

test("Dispatched means out for delivery, not completed", () => {
  // The pasted snippet mapped this to a generic "completed", which would close
  // the order before the rider leaves.
  assert.equal(mapPetpoojaStatus("Dispatched"), "OUT_FOR_DELIVERY");
});

test("status matching is case-insensitive and trims", () => {
  assert.equal(mapPetpoojaStatus("  food being prepared  "), "PREPARING");
  assert.equal(mapPetpoojaStatus("FOOD READY FOR DISPATCH"), "READY");
});

test("unknown statuses and blanks never invent a state", () => {
  assert.equal(mapPetpoojaStatus("Teleported"), null);
  assert.equal(mapPetpoojaStatus(""), null);
  assert.equal(mapPetpoojaStatus(null), null);
});

/* ------------------------------ callback -------------------------------- */

test("a status callback parses to a canonical transition", () => {
  const parsed = parsePetpoojaCallback({
    event_type: "order_status_update",
    orderID: "mkt_ord_7",
    status: "Food Being Prepared",
  });
  assert.equal(parsed.kind, "status");
  if (parsed.kind !== "status") return;
  assert.equal(parsed.externalOrderId, "mkt_ord_7");
  assert.equal(parsed.status, "PREPARING");
  assert.equal(
    parsed.eventId,
    petpoojaEventId("mkt_ord_7", "order_status_update", "Food Being Prepared"),
  );
});

test("the callback event id is stable across replays", () => {
  const body = {
    event_type: "order_status_update",
    orderID: 7,
    status: "Food Ready for Dispatch",
  };
  const first = parsePetpoojaCallback(body);
  const second = parsePetpoojaCallback(body);
  assert.equal(first.kind, "status");
  assert.equal(second.kind, "status");
  if (first.kind !== "status" || second.kind !== "status") return;
  assert.equal(first.externalOrderId, "7");
  assert.equal(first.eventId, second.eventId);
});

test("non-status and malformed callbacks are ignored, not applied", () => {
  assert.equal(
    parsePetpoojaCallback({ event_type: "order_created", orderID: "mkt_ord_7" }).kind,
    "ignored",
  );
  assert.equal(
    parsePetpoojaCallback({ event_type: "order_status_update", status: "Ready" }).kind,
    "ignored",
  );
  assert.equal(
    parsePetpoojaCallback({ event_type: "order_status_update", orderID: "mkt_ord_7", status: "Nope" }).kind,
    "ignored",
  );
});

/* ------------------------------ timestamp ------------------------------- */

test("a fresh ISO timestamp passes and a stale one fails", () => {
  const now = Date.parse("2026-10-30T12:00:00.000Z");
  assert.equal(petpoojaTimestampValid("2026-10-30T12:00:00.000Z", now), true);
  assert.equal(petpoojaTimestampValid("2026-10-30T11:54:00.000Z", now), false);
  assert.equal(petpoojaTimestampValid("not-a-date", now), false);
  assert.equal(petpoojaTimestampValid("", now), false);
});

test("Unix seconds and milliseconds are accepted", () => {
  const now = Date.parse("2026-10-30T12:00:00.000Z");
  const seconds = String(Math.floor(now / 1000));
  assert.equal(petpoojaTimestampValid(seconds, now), true);
  assert.equal(petpoojaTimestampValid(String(now), now), true);
  assert.equal(petpoojaTimestampValid(String(Math.floor(now / 1000) - 600), now), false);
});

/* ------------------------------ readiness ------------------------------- */

test("Petpooja readiness demands an active record, restID and partner credentials", () => {
  const base = { provider: "petpooja", posRestaurantId: "r", partnerCredentialsConfigured: true };
  assert.equal(
    integrationReadiness({ ...base, status: "pending" }).notReadyReason,
    "inactive",
  );
  assert.equal(
    integrationReadiness({ ...base, status: "active", posRestaurantId: null }).notReadyReason,
    "pos_restaurant_id",
  );
  assert.equal(
    integrationReadiness({ ...base, status: "active", partnerCredentialsConfigured: false })
      .notReadyReason,
    "provider_credentials",
  );
  assert.deepEqual(integrationReadiness({ ...base, status: "active" }), {
    ready: true,
    notReadyReason: null,
  });
});

test("a Petpooja record is ready without a sealed webhook secret", () => {
  // The Restaurant AI rule demands a secret to sign with; Petpooja authenticates
  // with partner credentials. Reusing the Restaurant AI rule here would leave
  // every Petpooja restaurant permanently unorderable.
  const rec = {
    status: "active",
    provider: "petpooja",
    posRestaurantId: "rest_9",
    webhookSecret: null,
    partnerCredentialsConfigured: true,
  };
  assert.equal(integrationReadiness(rec).ready, true);
  // ...and a Restaurant AI record in the same shape is NOT ready.
  assert.equal(integrationReadiness({ ...rec, provider: "restaurant-ai" }).ready, false);
});

test("an unknown provider is never ready", () => {
  // No adapter exists, so accepting the order would charge a customer for food
  // nothing can cook.
  const { ready, notReadyReason } = integrationReadiness({
    status: "active",
    provider: "mystery-pos",
    posRestaurantId: "r",
    webhookSecret: "sealed:v1:x",
    partnerCredentialsConfigured: true,
  });
  assert.equal(ready, false);
  assert.equal(notReadyReason, "unsupported_provider");
});

/* ---------------------------- push response ----------------------------- */

test("success:\"1\" is the only success shape that returns an order id", () => {
  assert.deepEqual(parsePetpoojaPushResponse({ success: "1", order_id: "12345" }), {
    ok: true,
    posOrderId: 12345,
    error: null,
  });
  assert.deepEqual(parsePetpoojaPushResponse({ success: 1, order_id: 999 }), {
    ok: true,
    posOrderId: 999,
    error: null,
  });
});

test("a logical failure carries the provider message and no order id", () => {
  const result = parsePetpoojaPushResponse({ success: "0", message: "Store closed" });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Store closed");
  assert.equal(result.posOrderId, null);
});

test("a response with no body is a failure, not a success", () => {
  assert.equal(parsePetpoojaPushResponse(null).ok, false);
  assert.equal(parsePetpoojaPushResponse("nope").ok, false);
});

/* ------------------------------ wiring ---------------------------------- */

function readSrc(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

test("the delivery bridge dispatches Petpooja before the Restaurant AI client", () => {
  const src = readSrc("src/integrations/pos/order-bridge.ts");
  assert.match(src, /ctx\.provider === "petpooja"/);
  assert.ok(
    src.indexOf("pushPetpoojaOrder(") !== -1,
    "the Petpooja adapter must be called",
  );
  assert.ok(
    src.indexOf("buildPetpoojaOrderPayload(") < src.indexOf("postPosOrderIngest("),
    "the provider branch must run before the Restaurant AI push",
  );
  assert.ok(
    src.indexOf("isClearedForPos(") < src.indexOf("pushPetpoojaOrder("),
    "the money gate must run before the Petpooja HTTP call",
  );
});

test("the webhook is budgeted, signature-gated and tenant-scoped", () => {
  const src = readSrc("src/lib/petpooja-webhook.ts");
  assert.match(src, /guardBudget\(req, "petpoojaWebhook"\)/);
  assert.match(src, /webhookSignaturesEqual\(/);
  assert.match(src, /if \(!secret\)/);
  assert.match(src, /resolveOrderTenantForPosCallback\(/);
  assert.match(src, /applyOrderStatusTransition\(/);
  assert.ok(!src.includes("req.json()"), "the raw body must be capped, not req.json()");
  assert.ok(!src.includes(".set({ status"), "must not write an arbitrary status column");
});

test("the callback route exists at the integrations webhook path", () => {
  const src = readSrc("src/app/api/integrations/webhooks/petpooja/route.ts");
  assert.match(src, /handlePetpoojaWebhook/);
});

test("payment pushes are skipped for a provider with no payment contract", () => {
  // Petpooja owns settlement on its side; there is no endpoint to receive the
  // Marketplace payment webhook. Journalling it anyway would retry against the
  // wrong POS until it burned every attempt and left queue health red.
  const bridge = readSrc("src/integrations/pos/payment-bridge.ts");
  assert.match(bridge, /posPaymentPushSupported\(/);
  assert.ok(
    bridge.indexOf("posPaymentPushSupported(") < bridge.indexOf("journalPaymentDelivery("),
    "the provider check must run before the journal row is created",
  );

  const journal = readSrc("src/db/payment-delivery.ts");
  assert.match(journal, /provider === DEFAULT_POS_PROVIDER/);
});

test("the ops route can wire a provider but refuses to re-route open orders", () => {
  const src = readSrc("src/app/api/ops/integrations/route.ts");
  assert.match(src, /requireOpsToken\(req\)/);
  assert.match(src, /readJsonBody\(req\)/);
  assert.ok(!src.includes("req.json()"), "the raw body must be capped, not req.json()");
  assert.match(src, /countOpenOrdersForRestaurant\(/);
  assert.match(src, /pos_integration\.provider_set/);
  // Only providers with an adapter may be selected.
  assert.match(src, /\[DEFAULT_POS_PROVIDER, "petpooja"\]/);
});

test("every readiness caller supplies Petpooja's credential fact", () => {
  // `integrationReadiness` is pure, so a caller that omits this fails a
  // Petpooja record closed. Each of these sites is on a money path.
  for (const rel of [
    "src/db/queries.ts",
    "src/integrations/pos/resolve-outlet.ts",
    "src/integrations/pos/order-bridge.ts",
  ]) {
    const src = readSrc(rel);
    assert.match(src, /petpoojaConfigured\(\)/, `${rel} must pass the credential fact`);
  }
});

test("the shared gate and the partner console understand provider readiness", () => {
  const readiness = readSrc("src/integrations/pos/readiness.ts");
  assert.match(readiness, /provider === "petpooja"/);
  assert.match(readiness, /provider_credentials/);
  assert.match(readiness, /unsupported_provider/);

  const page = readSrc("src/app/partner/integrations/page.tsx");
  assert.match(page, /provider_credentials:/);
  assert.match(page, /unsupported_provider:/);
});

