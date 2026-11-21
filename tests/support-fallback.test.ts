/**
 * Support discoverability on shared tracking links.
 *
 * A `/order/track/<token>` link is read-only: the tracking token proves the
 * reader may follow the order, but not chat about it (that needs the HMAC
 * order token from the browser that placed it). Before this fallback the
 * support card simply vanished on another device, so a customer could track
 * an order but had no visible way to ask for help. These tests pin both the
 * hand-off component and the /contact destination that receives the code.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { contactOrderCode, CONTACT_ORDER_MAX_CHARS } from "../src/lib/contact-order-core";
import { LEGAL, supportMailto } from "../src/lib/site-legal";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

test("a normal order code survives the hand-off, normalised", () => {
  assert.equal(contactOrderCode(" crv-a2b3c "), "CRV-A2B3C");
  assert.equal(contactOrderCode("CRV-TEST"), "CRV-TEST");
});

test("a missing, duplicated or malformed order value is dropped", () => {
  assert.equal(contactOrderCode(undefined), null);
  assert.equal(contactOrderCode(null), null);
  assert.equal(contactOrderCode(42), null);
  assert.equal(contactOrderCode(["CRV-A2B3C", "CRV-XXXX"]), null);
  assert.equal(contactOrderCode(""), null);
  assert.equal(contactOrderCode("   "), null);
  // URL junk and whitespace inside the value must not reach a mailto link.
  assert.equal(contactOrderCode("CRV-A2B3C&body=injected"), null);
  assert.equal(contactOrderCode("CRV A2B3C"), null);
  assert.equal(contactOrderCode("<script>"), null);
});

test("an over-long order code is dropped rather than truncated into another code", () => {
  assert.equal(contactOrderCode("C".repeat(CONTACT_ORDER_MAX_CHARS)), "C".repeat(CONTACT_ORDER_MAX_CHARS));
  assert.equal(contactOrderCode("C".repeat(CONTACT_ORDER_MAX_CHARS + 1)), null);
});

test("supportMailto prefills the order code when one was handed over", () => {
  const bare = supportMailto();
  assert.equal(bare, `mailto:${LEGAL.supportEmail}`);

  const prefilled = supportMailto("CRV-A2B3C");
  assert.ok(prefilled.startsWith(`mailto:${LEGAL.supportEmail}?`));
  assert.ok(prefilled.includes(encodeURIComponent("Order support: CRV-A2B3C")));
  assert.ok(prefilled.includes(encodeURIComponent("Order code: CRV-A2B3C")));
});

test("the tracking view offers the contact fallback when there is no HMAC token", () => {
  const view = source("src/components/tracking-view.tsx");
  assert.match(view, /OrderSupportFallback/);
  const branch = view.slice(view.indexOf("{supportAccess ? ("));
  assert.match(branch, /<OrderSupport code=\{order\.code\} token=\{token\} \/>/);
  assert.match(branch, /<OrderSupportFallback code=\{order\.code\} \/>/);
});

test("the fallback links to /contact with the order code", () => {
  const support = source("src/components/order-support.tsx");
  assert.match(support, /export function OrderSupportFallback/);
  assert.match(
    support,
    /href=\{`\/contact\?order=\$\{encodeURIComponent\(code\)\}`\}/,
  );
});

test("/contact reads and filters the handed-over code, then uses the shared mailto", () => {
  const contact = source("src/app/contact/page.tsx");
  assert.match(contact, /contactOrderCode\(params\.order\)/);
  assert.match(contact, /supportMailto\(orderCode/);
  assert.match(contact, /orderCode && \(/);
});
