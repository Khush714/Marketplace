/**
 * Pure rules for the device-scoped notification inbox. Keep this file free of
 * server-only imports: the browser and the tests must agree on token shape and
 * message copy.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  INBOX_STORAGE_KEY,
  INBOX_TOKEN_PATTERN,
  isInboxToken,
  newInboxToken,
  notificationCopy,
  notificationDedupeKey,
  type CustomerNotificationKind,
} from "../src/lib/customer-notification-copy";

test("generated inbox tokens are high-entropy and pass validation", () => {
  const token = newInboxToken();
  assert.match(token, INBOX_TOKEN_PATTERN);
  assert.equal(token.length, 64);
  assert.equal(isInboxToken(token), true);
  assert.equal(isInboxToken("short"), false);
  assert.equal(isInboxToken("!".repeat(64)), false);
  assert.equal(isInboxToken(undefined), false);
  assert.equal(INBOX_STORAGE_KEY, "crave.inbox.v1");
});

test("order status copy covers the canonical Marketplace states", () => {
  const states = [
    "PLACED",
    "ACCEPTED",
    "PREPARING",
    "READY",
    "OUT_FOR_DELIVERY",
    "DELIVERED",
    "COMPLETED",
    "CANCELLED",
    "REJECTED",
  ];
  for (const state of states) {
    const copy = notificationCopy("order_status", state);
    assert.ok(copy.title.length > 0, `missing title for ${state}`);
    assert.ok(copy.body.length > 0, `missing body for ${state}`);
    assert.notEqual(copy.title, "Order update", `unmapped status: ${state}`);
  }
});

test("payment, delivery and reply copy never falls back to an empty message", () => {
  const cases: Array<[CustomerNotificationKind, string]> = [
    ["order_placed", ""],
    ["delivery", "OUT_FOR_DELIVERY"],
    ["payment", "PAID"],
    ["payment", "REFUNDED"],
    ["feedback_reply", ""],
    ["order_status", "SOME_NEW_STATUS"],
  ];
  for (const [kind, detail] of cases) {
    const copy = notificationCopy(kind, detail);
    assert.ok(copy.title.length > 0);
    assert.ok(copy.body.length > 0);
  }
});

test("dedupe keys are stable for replays and distinct per state change", () => {
  const first = notificationDedupeKey(42, "order_status", "ACCEPTED");
  assert.equal(first, notificationDedupeKey(42, "order_status", "ACCEPTED"));
  assert.notEqual(first, notificationDedupeKey(42, "order_status", "READY"));
  assert.notEqual(first, notificationDedupeKey(42, "payment", "ACCEPTED"));
  assert.notEqual(first, notificationDedupeKey(43, "order_status", "ACCEPTED"));
  assert.equal(notificationDedupeKey(42, "order_placed"), "42:order_placed:default");
});

/* ------------------------------- wiring ---------------------------------- */

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

test("checkout keeps the raw token client-side and persists only its hash", () => {
  const whitelist = source("src/lib/order-input-core.ts");
  assert.match(whitelist, /inboxToken\?: string/);
  assert.match(whitelist, /isInboxToken\(body\.inboxToken\)/);

  const checkout = source("src/app/checkout/page.tsx");
  assert.match(checkout, /inboxToken: ensureInboxToken\(\)/);

  const route = source("src/app/api/orders/route.ts");
  assert.match(route, /const \{ inboxToken, \.\.\.orderInput \} = validated\.request;/);
  assert.match(route, /hashInboxToken\(inboxToken\)/);
  assert.match(route, /createOrder\(\{\s*\.\.\.orderInput,/);
  assert.doesNotMatch(route, /createOrder\(\{\s*\.\.\.validated\.request,/);
  assert.match(route, /kind: "order_placed"/);

  const queries = source("src/db/queries.ts");
  assert.match(queries, /customerInboxHash\?: string \| null/);
  assert.match(queries, /customerInboxHash: input\.customerInboxHash \?\? null/);
});

test("the inbox API is token-gated, budgeted, non-cacheable and account-free", () => {
  const api = source("src/app/api/notifications/route.ts");
  assert.match(api, /guardRead\(req, "notificationRead"\)/);
  assert.match(api, /guardWrite\(req, "notificationWrite"\)/);
  assert.match(api, /isInboxToken\(token\)/);
  assert.match(api, /hashInboxToken\(token\)/);
  assert.match(api, /"Cache-Control": "no-store"/);
  assert.match(api, /Number\.isSafeInteger\(value\)/);
  assert.doesNotMatch(api, /resolveAccountSession/);
  assert.doesNotMatch(api, /crypto\.randomUUID/);

  const budgets = source("src/lib/abuse-core.ts");
  assert.match(budgets, /notificationRead: \{ limit: 120/);
  assert.match(budgets, /notificationWrite: \{ limit: 60/);
});

test("record/list/read helpers hash once, dedupe and swallow failures", () => {
  const helper = source("src/lib/customer-notifications.ts");
  assert.match(helper, /createHash\("sha256"\)/);
  assert.match(helper, /onConflictDoNothing\(\)/);
  assert.match(helper, /console\.error\("\[customer-notifications\] record failed"/);
  assert.match(helper, /inArray\(customerNotifications\.id, validIds\)/);
  assert.match(helper, /orderCode: orders\.code/);
});

test("schema and migration create a hash-scoped, deduped inbox table", () => {
  const schema = source("src/db/schema.ts");
  assert.match(schema, /customerInboxHash: text\("customer_inbox_hash"\)/);
  assert.match(schema, /pgTable\(\s*"customer_notifications"/);
  assert.match(schema, /uniqueIndex\("customer_notifications_inbox_dedupe_unique"\)/);

  const migration = source("src/db/migrations/20261126_customer_notifications.sql");
  assert.match(migration, /ADD COLUMN IF NOT EXISTS customer_inbox_hash text/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.customer_notifications/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.customer_notifications FROM PUBLIC/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE/);
  // Marketplace's runtime role has NOBYPASSRLS; enabling RLS here would make
  // every inbox read and write fail. Tenant isolation is the token hash.
  assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY/);
});

test("the bell, panel and polling live in the app shell without push APIs", () => {
  const providers = source("src/components/providers.tsx");
  assert.match(
    providers,
    /<ToastProvider>[\s\S]*<CustomerNotificationsProvider>[\s\S]*<\/CustomerNotificationsProvider>[\s\S]*<\/ToastProvider>/,
  );

  const header = source("src/components/site-header.tsx");
  assert.equal(header.match(/<NotificationBell \/>/g)?.length, 2, "bell must exist in both header layouts");

  const ui = source("src/components/customer-notifications.tsx");
  assert.match(ui, /const POLL_MS = 15_000/);
  assert.match(ui, /role="dialog"/);
  assert.match(ui, /aria-modal="true"/);
  assert.match(ui, /Private to this browser\. No push notifications, email or SMS\./);
  assert.doesNotMatch(ui, /serviceWorker|pushManager|registration/);

  const consent = source("src/lib/consent.tsx");
  assert.match(consent, /crave\.inbox\.v1/);
});
