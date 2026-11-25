import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  MAX_TIP_CENTS,
  parseCancelReason,
  parseScheduledFor,
  parseTipCents,
  scheduledSlotOpen,
  withTip,
} from "../src/lib/checkout-extras-core";
import { isLocalMediaUrl, parseMediaUpload, parsePhotoIds } from "../src/lib/media-core";
import { mergeCartStates, normalizeCartState } from "../src/lib/cart-sync-core";
import { filterHistory, paginateHistory, parseHistoryQuery } from "../src/lib/order-history-core";
import { invoiceDocument, invoiceHtml } from "../src/lib/invoice-core";
import { maskIp, redactAuditDetail } from "../src/lib/audit-redaction-core";

const baseBill = {
  subtotalCents: 30_000,
  deliveryFeeCents: 3_900,
  platformFeeCents: 600,
  discountCents: 0,
  totalCents: 34_500,
};

const restaurant = {
  isActive: true,
  merchantHoursEnabled: true,
  merchantOpensAt: "10:00",
  merchantClosesAt: "22:00",
  scheduledLeaves: [],
};

function params(values: Record<string, string>) {
  return { get: (name: string) => values[name] ?? null };
}

test("tips are integer paise and cannot exceed the platform cap", () => {
  assert.deepEqual(parseTipCents(undefined), { ok: true, tipCents: 0 });
  assert.deepEqual(parseTipCents("5000"), { ok: true, tipCents: 5000 });
  assert.equal(parseTipCents(MAX_TIP_CENTS + 1).ok, false);
  assert.equal(parseTipCents(12.5).ok, false);
  assert.equal(parseTipCents(-1).ok, false);
  assert.deepEqual(withTip(baseBill, 5_000).totalCents, 39_500);
  assert.equal(baseBill.totalCents, 34_500);
});

test("scheduled slots enforce lead time, horizon, closures and hours", () => {
  const now = new Date("2026-11-25T04:00:00.000Z"); // 09:30 IST
  const tooSoon = new Date(now.getTime() + 20 * 60_000).toISOString();
  const tooLate = new Date(now.getTime() + 8 * 86_400_000).toISOString();
  const inHours = new Date(now.getTime() + 90 * 60_000).toISOString(); // 11:00 IST
  const outsideHours = "2026-11-25T16:30:00.000Z"; // 22:00 IST, closing time

  assert.equal(parseScheduledFor(tooSoon, now).ok, false);
  assert.equal(parseScheduledFor(tooLate, now).ok, false);
  assert.equal(parseScheduledFor(123 as unknown, now).ok, false);
  assert.equal(parseScheduledFor(inHours, now).ok, true);
  assert.equal(scheduledSlotOpen(inHours, restaurant), true);
  assert.equal(scheduledSlotOpen(outsideHours, restaurant), false);
  assert.equal(
    scheduledSlotOpen(inHours, { ...restaurant, scheduledLeaves: [{ date: "2026-11-25", reason: "Closed" }] }),
    false,
  );
});

test("cancellation reasons collapse unknown values instead of storing arbitrary notes", () => {
  assert.equal(parseCancelReason("changed_mind"), "changed_mind");
  assert.equal(parseCancelReason("delivery_too_late"), "delivery_too_late");
  assert.equal(parseCancelReason("drop all orders"), "other");
  assert.equal(parseCancelReason(42), "other");
});

test("uploaded bytes are bounded and matched to their declared image type", () => {
  const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+8d0AAAAASUVORK5CYII=", "base64"));
  const encoded = Buffer.from(png).toString("base64");
  const ok = parseMediaUpload({ kind: "review", contentType: "image/png", dataBase64: encoded });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.bytes.length, png.length);

  assert.equal(parseMediaUpload({ kind: "menu", contentType: "image/png", dataBase64: encoded }).ok, true);
  assert.equal(parseMediaUpload({ kind: "other", contentType: "image/png", dataBase64: encoded }).ok, false);
  assert.equal(parseMediaUpload({ kind: "review", contentType: "text/html", dataBase64: encoded }).ok, false);
  assert.equal(
    parseMediaUpload({ kind: "review", contentType: "image/png", dataBase64: Buffer.from("not a png").toString("base64") }).ok,
    false,
  );
  assert.deepEqual(parsePhotoIds([1, 2, 1, -3, "4", 5, 6]), [1, 2]);
  assert.equal(isLocalMediaUrl("/api/media/12"), true);
  assert.equal(isLocalMediaUrl("https://evil.example/api/media/12"), false);
});

test("cart sync normalizes and merges without inventing lines", () => {
  const local = normalizeCartState({
    restaurantSlug: "spice-garden",
    restaurantName: "Spice Garden",
    items: [{ menuItemId: 7, name: "Dosa", quantity: 2, priceCents: 100, imageUrl: "", isVeg: true }],
  });
  assert.ok(local);
  assert.equal(local.items[0].lineKey, "7");
  assert.equal(local.items[0].quantity, 2);
  assert.equal(normalizeCartState({ items: [{ menuItemId: 0, name: "Bad" }] })?.items.length, 0);
  assert.deepEqual(mergeCartStates(local, null), local);
  assert.deepEqual(mergeCartStates(local, normalizeCartState({ restaurantSlug: "", restaurantName: "", items: [] })), local);
});

test("history filters and paginates without trusting unbounded query values", () => {
  const query = parseHistoryQuery(params({ limit: "999", offset: "1", status: "completed", q: "dosa", from: "2026-11-01" }));
  assert.equal(query.limit, 60);
  assert.equal(query.offset, 1);
  assert.equal(query.status, "completed");
  const rows = [
    { code: "A", createdAt: "2026-11-24T10:00:00.000Z", restaurantName: "Spice Garden", status: { stageKey: "delivered" }, items: [{ name: "Dosa" }] },
    { code: "B", createdAt: "2026-11-25T10:00:00.000Z", restaurantName: "Spice Garden", status: { stageKey: "cancelled" }, items: [{ name: "Dosa" }] },
  ];
  const filtered = filterHistory(rows, query);
  assert.equal(filtered.length, 1);
  assert.deepEqual(filtered[0].code, "A");
  assert.deepEqual(paginateHistory(filtered, query).orders, []);
});

test("invoice receipts escape user data and show the tip as its own line", () => {
  const html = invoiceHtml({
    ...baseBill,
    code: "MKT-1",
    createdAt: "2026-11-25T10:00:00.000Z",
    restaurantName: "Spice & <Garden>",
    customerName: "<script>alert(1)</script>",
    addressText: "12, Test Street",
    paymentStatus: "PAID",
    paymentMethod: "upi",
    tipCents: 5_000,
    totalCents: 39_500,
    items: [{ menuItemId: 1, name: "Dosa", priceCents: 100, quantity: 2, imageUrl: "", isVeg: true }],
  });
  assert.match(html, /₹50\.00/);
  assert.match(html, /₹395\.00/);
  assert.doesNotMatch(html, /<script>/);
  const doc = invoiceDocument({
    ...baseBill,
    code: "MKT-1",
    createdAt: "2026-11-25T10:00:00.000Z",
    restaurantName: "Spice Garden",
    customerName: "Asha",
    addressText: "12, Test Street",
    paymentStatus: "PAID",
    paymentMethod: "upi",
    tipCents: 5_000,
    totalCents: 39_500,
    items: [{ menuItemId: 1, name: "Dosa", priceCents: 100, quantity: 2, imageUrl: "", isVeg: true }],
  });
  assert.equal(doc.documentNumber, "RCP-MKT-1");
  assert.equal(doc.lines[0].amountCents, 200);
});

test("audit rows are redacted before an operator can read them", () => {
  const redacted = redactAuditDetail({ ok: true, api_key: "sk_live_secret", nested: { webhook_secret: "abc" }, count: 2 });
  assert.deepEqual(redacted, { ok: true, api_key: "••••", nested: { webhook_secret: "••••" }, count: 2 });
  assert.equal(maskIp("103.24.8.19"), "103.24.***.***");
  assert.notEqual(maskIp("2001:db8::1"), "2001:db8::1");
});

test("migration and schema agree on the new columns and tables", () => {
  const migration = readFileSync(new URL("../src/db/migrations/20261130_table_stakes_polish.sql", import.meta.url), "utf8");
  const schema = readFileSync(new URL("../src/db/schema.ts", import.meta.url), "utf8");
  assert.match(migration, /account_id integer NOT NULL/);
  assert.match(migration, /tip_cents integer NOT NULL DEFAULT 0/);
  assert.match(migration, /review_photo_ids integer\[\]/);
  assert.match(schema, /accountId: integer\("account_id"\)/);
  assert.match(schema, /reviewPhotoIds: integer\("review_photo_ids"\)/);
});
