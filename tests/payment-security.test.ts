/**
 * Tests for the Phase 9 payment security boundary.
 *
 * Run with: npm test
 *
 * Phase 9's critical rule is one sentence:
 *
 *   browser says SUCCESS ──✗──▶ order PAID
 *   provider says SUCCESS ──▶ signature verified ──▶ order PAID
 *
 * The state machine itself lives behind the database (db/payments.ts) and
 * cannot run under `node --test`, so what is pinned here is everything around
 * it that keeps the rule true:
 *
 *   - the channel decision: which arrival channels may assert verification,
 *     and which (the local dev stand-in) must never;
 *   - the provenance column: `signature_verified` exists on the row, so "who
 *     told us this money moved" is answerable from the data;
 *   - the wiring: the webhook passes its HMAC-verified channel, the checkout
 *     callback passes the signature-verified one, dev passes its own;
 *   - the write locus: NOTHING outside db/payments.ts ever writes PAID, so no
 *     route can promote an order because a browser claimed success;
 *   - the abuse budgets: the two provider-spending endpoints are throttled,
 *     and they are actually guarded.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, globSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  PAID_STATUSES,
  channelVerifiesSignature,
  isAuthorizedAwaitingCapture,
  isPaidStatus,
} from "../src/lib/payment-security-core";
import { ABUSE_BUDGETS } from "../src/lib/abuse-core";

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const WEBHOOK_ROUTE = "src/app/api/integrations/payments/webhook/route.ts";
const VERIFY_ROUTE = "src/app/api/orders/[code]/pay/verify/route.ts";
const START_ROUTE = "src/app/api/orders/[code]/pay/start/route.ts";
const PAYMENTS_STORE = "src/db/payments.ts";

/* ---------------------------- channel trust ---------------------------- */

test("webhook and checkout channels assert signature verification", () => {
  assert.equal(channelVerifiesSignature("webhook"), true);
  assert.equal(channelVerifiesSignature("checkout"), true);
});

test("the dev stand-in never claims a verified signature", () => {
  // The one channel whose "success" originates on the client must record
  // signature_verified = false even though it drives the same state machine.
  assert.equal(channelVerifiesSignature("dev"), false);
});

/* ------------------------------ paid status ----------------------------- */

test("only captured-money statuses count as paid", () => {
  assert.equal(isPaidStatus("PAID"), true);
  assert.equal(isPaidStatus("captured"), true);
  // A refund is money that was captured and handed back — not "paid".
  for (const status of ["REFUNDED", "PARTIALLY_REFUNDED", "REFUND_PENDING"]) {
    assert.equal(isPaidStatus(status), false, `${status} must not read as paid`);
  }
  for (const status of ["UNPAID", "PAYMENT_PENDING", "FAILED", "PAYMENT_CANCELLED"]) {
    assert.equal(isPaidStatus(status), false, `${status} must not read as paid`);
  }
  assert.deepEqual([...PAID_STATUSES], ["PAID", "CAPTURED"]);
});

/* ------------------------- capture-on-authorize ------------------------- */

test("only an authorized payment is awaiting a capture", () => {
  // Auto-capture off leaves a completed payment at `authorized`; that is the
  // one provider status the server must actively capture. Everything else is
  // either already settled or still in flight and must be left alone.
  for (const s of ["authorized", "AUTHORIZED", " authorized "]) {
    assert.equal(isAuthorizedAwaitingCapture(s), true, `${s} awaits a capture`);
  }
  for (const s of ["captured", "created", "failed", "refunded", "", null, undefined]) {
    assert.equal(isAuthorizedAwaitingCapture(s), false, `${String(s)} is not awaiting a capture`);
  }
});

test("the checkout callback and the webhook capture an authorized payment", () => {
  // Both provider-verified entry points must settle an authorized payment
  // themselves, so a deployment with auto-capture off and no capture webhook
  // still completes real money.
  for (const route of [VERIFY_ROUTE, WEBHOOK_ROUTE]) {
    assert.match(
      readSource(route),
      /captureProviderPayment\(/,
      `${route} must capture an authorized payment`,
    );
  }
  // The capture must POST to the provider's capture endpoint, using the
  // server-held secret — never an amount a client supplied.
  const session = readSource("src/integrations/payments/provider-session.ts");
  assert.match(session, /\/capture`/);
  assert.match(session, /method:\s*"POST"/);
});

/* --------------------------- provenance column -------------------------- */

test("the payments row carries signature_verified, and the migration adds it", () => {
  const schema = readSource("src/db/schema.ts");
  assert.match(
    schema,
    /signatureVerified:\s*boolean\("signature_verified"\)\.notNull\(\)\.default\(false\)/,
    "marketplace_payments must record whether a verified channel vouches for its status",
  );

  const migration = "src/db/migrations/20261007_payment_signature_verification.sql";
  assert.ok(existsSync(join(process.cwd(), migration)), `missing migration ${migration}`);
  const sql = readSource(migration);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "signature_verified" boolean NOT NULL DEFAULT false/);
});

/* ------------------------------- wiring --------------------------------- */

test("the webhook applies events as a signature-verified channel", () => {
  const src = readSource(WEBHOOK_ROUTE);
  // The frame is HMAC-checked with the webhook secret over the raw bytes
  // before it reaches the store — that is what makes "webhook" honest.
  assert.match(src, /createHmac\("sha256", secret\)/);
  assert.match(src, /timingSafeEqual/);
  assert.match(src, /channel:\s*"webhook"/);
});

test("the checkout callback names its channel, and dev names its own", () => {
  const src = readSource(VERIFY_ROUTE);
  assert.match(
    src,
    /verifyCheckoutSignature\(/,
    "the browser's checkout triple must be signature-verified before it counts",
  );
  assert.match(
    src,
    /fetchProviderPayment\(/,
    "money facts must be re-read from the provider, never taken from the body",
  );
  assert.match(src, /channel:\s*"checkout"/);
  assert.match(src, /channel:\s*"dev"/);
});

test("nothing outside the payment store writes PAID", () => {
  // The critical rule, mechanically: a route, component or integration that
  // could flip an order to PAID would make a browser claim sufficient. Only
  // db/payments.ts — behind signature verification and the amount check — may.
  //
  // Matched are WRITE shapes (`.set({ paymentStatus: "PAID" })` on an order,
  // `.set({ status: "PAID" })` on a payment), not comparisons or responses:
  // pay/start answering `{ status: "PAID", alreadyPaid: true }` for an order
  // that is already paid is a read, and reads are allowed to be true.
  const files = globSync("src/**/*.{ts,tsx}").filter(
    (f: string) => f.replace(/\\/g, "/") !== "src/db/payments.ts",
  );
  assert.ok(files.length > 50, "expected the source glob to actually scan the app");
  for (const file of files) {
    const src = readFileSync(join(process.cwd(), file), "utf8");
    const writesPaid =
      /paymentStatus:\s*"PAID"/.test(src) ||
      /\bset\(\s*\{[\s\S]{0,400}?\bstatus:\s*"PAID"/.test(src);
    assert.ok(!writesPaid, `${file} writes a PAID payment status — only src/db/payments.ts may`);
  }
});

/* ---------------------------- abuse budgets ----------------------------- */

test("the provider-spending payment endpoints are budgeted", () => {
  for (const scope of ["paymentStart", "paymentVerify"] as const) {
    const budget = ABUSE_BUDGETS[scope];
    assert.ok(budget, `ABUSE_BUDGETS.${scope} is missing`);
    // Enough for a real customer resuming payments, far below a grinding loop.
    assert.ok(budget.limit >= 10, `${scope} budget too tight for real retries`);
    assert.ok(budget.limit <= 60, `${scope} budget too generous to stop a script`);
    assert.ok(budget.windowMs <= 15 * 60_000, `${scope} window far too long`);
  }
});

test("pay/start and pay/verify are actually guarded", () => {
  assert.match(readSource(START_ROUTE), /guardWrite\(req,\s*"paymentStart"\)/);
  assert.match(readSource(VERIFY_ROUTE), /guardWrite\(req,\s*"paymentVerify"\)/);
  // Guarded before the token check, so an unauthenticated grind costs no query.
  const start = readSource(START_ROUTE);
  assert.ok(
    start.indexOf('guardWrite(req, "paymentStart")') < start.indexOf("verifyOrderToken("),
    "paymentStart must be budgeted before any lookup",
  );
});
