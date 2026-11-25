import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assertPayoutBatchTransition,
  buildPayoutPreview,
  normalizePayoutChecksum,
  normalizePayoutCycle,
  normalizePayoutReference,
  payoutChecksum,
  payoutCycleWindow,
  PayoutInputError,
  type PayoutSettlementInput,
} from "../src/lib/payout-core";
import { emptyMerchantPayoutFeed, toMerchantPayoutBatch } from "../src/lib/merchant-payout-feed";

const PERIOD = { periodStart: new Date("2026-11-09T00:00:00.000Z"), periodEnd: new Date("2026-11-16T00:00:00.000Z") };

function settlement(overrides: Partial<PayoutSettlementInput> = {}): PayoutSettlementInput {
  return {
    externalId: "payment:pay_1",
    marketplaceOrderId: "CRV-5KKQH",
    currency: "INR",
    status: "PAID",
    signatureVerified: true,
    grossPaise: 50_000,
    commissionPaise: 1_500,
    refundPaise: 0,
    adjustmentPaise: 0,
    netPaise: 48_500,
    capturedAt: new Date("2026-11-12T10:00:00.000Z"),
    ...overrides,
  };
}

function reasons(preview: ReturnType<typeof buildPayoutPreview>): Record<string, string> {
  return Object.fromEntries(preview.exclusions.map((row) => [row.settlementExternalId, row.reason]));
}

test("weekly payouts price the last fully closed Monday-to-Monday window", () => {
  const window = payoutCycleWindow("weekly", new Date("2026-11-18T14:00:00.000Z"));
  assert.equal(window.periodStart.toISOString(), "2026-11-09T00:00:00.000Z");
  assert.equal(window.periodEnd.toISOString(), "2026-11-16T00:00:00.000Z");
  assert.equal(window.idempotencyKey, "weekly:2026-11-09");
});

test("monthly payouts never span into the current calendar month", () => {
  const window = payoutCycleWindow("monthly", new Date("2026-11-18T14:00:00.000Z"));
  assert.equal(window.periodStart.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(window.periodEnd.toISOString(), "2026-11-01T00:00:00.000Z");
});

test("fortnightly cycles are distinct from weekly and biweekly aliases", () => {
  assert.equal(normalizePayoutCycle("weekly"), "weekly");
  assert.equal(normalizePayoutCycle("FORTNIGHTLY"), "fortnightly");
  assert.equal(normalizePayoutCycle("monthly"), "monthly");
  assert.throws(() => normalizePayoutCycle("biweekly"), PayoutInputError);
  assert.throws(() => normalizePayoutCycle("daily"), PayoutInputError);
});

test("approval identifiers cannot be smuggled through as arbitrary strings", () => {
  const reference = `pb_${"a".repeat(24)}`;
  const checksum = "b".repeat(32);
  assert.equal(normalizePayoutReference(reference.toUpperCase()), reference);
  assert.equal(normalizePayoutChecksum(checksum.toUpperCase()), checksum);
  assert.throws(() => normalizePayoutReference("batch/../../admin"), PayoutInputError);
  assert.throws(() => normalizePayoutReference("pb_short"), PayoutInputError);
  assert.throws(() => normalizePayoutChecksum("not-a-hash"), PayoutInputError);
});

test("preview pays only verified, positive-net INR settlements inside the window", () => {
  const preview = buildPayoutPreview({
    window: PERIOD,
    settlements: [
      settlement(),
      settlement({ externalId: "payment:allocated" }),
      settlement({ externalId: "payment:unverified", signatureVerified: false }),
      settlement({ externalId: "payment:pending", status: "PAYMENT_PENDING" }),
      settlement({ externalId: "payment:refunded", status: "REFUNDED" }),
      settlement({ externalId: "payment:usd", currency: "USD" }),
      settlement({ externalId: "payment:old", capturedAt: new Date("2026-11-08T23:59:59.000Z") }),
      settlement({ externalId: "payment:future", capturedAt: new Date("2026-11-16T00:00:00.000Z") }),
      settlement({ externalId: "payment:negative", grossPaise: 1_000, commissionPaise: 1_000, netPaise: 0 }),
      settlement({ externalId: "payment:mismatch", netPaise: 48_000 }),
    ],
    alreadyAllocated: new Set(["payment:allocated"]),
  });

  assert.deepEqual(preview.lines.map((line) => line.settlementExternalId), ["payment:pay_1"]);
  assert.equal(preview.totals.netPaise, 48_500);
  assert.equal(preview.totals.lineCount, 1);
  const excluded = reasons(preview);
  assert.equal(excluded["payment:unverified"], "unverified");
  assert.equal(excluded["payment:pending"], "not_paid");
  assert.equal(excluded["payment:refunded"], "not_paid");
  assert.equal(excluded["payment:usd"], "wrong_currency");
  assert.equal(excluded["payment:old"], "outside_period");
  assert.equal(excluded["payment:future"], "outside_period");
  assert.equal(excluded["payment:negative"], "non_positive_net");
  assert.equal(excluded["payment:mismatch"], "amount_mismatch");
  assert.equal(excluded["payment:allocated"], "already_allocated");
});

test("a settlement already allocated to a batch cannot be priced again", () => {
  const preview = buildPayoutPreview({
    window: PERIOD,
    settlements: [settlement()],
    alreadyAllocated: new Set(["payment:pay_1"]),
  });
  assert.equal(preview.lines.length, 0);
  assert.equal(preview.totals.netPaise, 0);
  assert.equal(preview.checksum, payoutChecksum([]));
});

test("checksum changes with the exact settlement set and is order independent", () => {
  const first = settlement({ externalId: "a" });
  const second = settlement({
    externalId: "b",
    grossPaise: 10_000,
    commissionPaise: 0,
    refundPaise: 0,
    adjustmentPaise: 0,
    netPaise: 10_000,
  });
  const forward = buildPayoutPreview({ window: PERIOD, settlements: [first, second] });
  const reverse = buildPayoutPreview({ window: PERIOD, settlements: [second, first] });
  assert.equal(forward.checksum, reverse.checksum);
  assert.notEqual(forward.checksum, payoutChecksum([{ settlementExternalId: "a", netPaise: 48_500 }]));
});

test("batch transitions do not allow a preview or cancelled batch to move money", () => {
  assertPayoutBatchTransition("PREVIEW", "APPROVED");
  assertPayoutBatchTransition("APPROVED", "PROCESSING");
  assert.throws(() => assertPayoutBatchTransition("PREVIEW", "PAID"), PayoutInputError);
  assert.throws(() => assertPayoutBatchTransition("PAID", "PROCESSING"), PayoutInputError);
  assert.throws(() => assertPayoutBatchTransition("CANCELLED", "APPROVED"), PayoutInputError);
});

test("Merchant feed hides previews and cancellations and never exposes raw destinations", () => {
  const line = { settlementExternalId: "payment:pay_1", netPaise: 48_500 };
  const base = {
    reference: "pb_1",
    netPaise: 48_500,
    approvedAt: new Date("2026-11-17T00:00:00.000Z"),
    createdAt: new Date("2026-11-16T00:00:00.000Z"),
    paidAt: null,
    maskedLabel: "Bank ••••1234 (HDFC0000001)",
    allocations: [line],
  };
  assert.equal(toMerchantPayoutBatch({ ...base, status: "PREVIEW" }), null);
  assert.equal(toMerchantPayoutBatch({ ...base, status: "CANCELLED" }), null);
  assert.deepEqual(toMerchantPayoutBatch({ ...base, status: "APPROVED" }), {
    reference: "pb_1",
    methodLabel: "Bank ••••1234 (HDFC0000001)",
    status: "scheduled",
    amountPaise: 48_500,
    initiatedAt: "2026-11-17T00:00:00.000Z",
    completedAt: null,
    allocations: [{ settlementExternalId: "payment:pay_1", amountPaise: 48_500 }],
  });
  assert.equal(emptyMerchantPayoutFeed().available, false);
});

test("the Merchant payout routes are authenticated, budgeted, dynamic and read-only where required", () => {
  const read = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8");
  const feed = read("src/app/api/integration/merchant/payouts/route.ts");
  const preview = read("src/app/api/integration/merchant/payouts/preview/route.ts");
  const settings = read("src/app/api/integration/merchant/payout-settings/route.ts");

  for (const [name, source] of [["feed", feed], ["preview", preview], ["settings GET", settings]] as const) {
    assert.match(source, /export const dynamic = "force-dynamic"/, name);
    assert.match(source, /guardBudget\(req, "merchantServiceRead"\)/, name);
    assert.match(source, /authenticateMerchantApp\(req\)/, name);
    assert.match(source, /unauthenticatedMerchantApp\(\)/, name);
    assert.match(source, /["']?Cache-Control["']?:\s*["']no-store["']/, name);
  }
  assert.doesNotMatch(feed, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(preview, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.match(settings, /guardBudget\(req, "merchantServiceWrite"\)/);
  assert.match(settings, /readJsonBody\(req\)/);
  assert.match(settings, /normalizePayoutCycle\(body\.cycle\)/);
});

test("batch creation and approval are write-guarded and reprice before queueing", () => {
  const read = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8");
  const create = read("src/app/api/integration/merchant/payouts/batches/route.ts");
  const approve = read("src/app/api/integration/merchant/payouts/batches/[reference]/approve/route.ts");
  const store = read("src/db/merchant-payouts.ts");

  for (const [name, source] of [["create", create], ["approve", approve]] as const) {
    assert.match(source, /export const dynamic = "force-dynamic"/, name);
    assert.match(source, /guardBudget\(req, "merchantServiceWrite"\)/, name);
    assert.match(source, /authenticateMerchantApp\(req\)/, name);
    assert.match(source, /unauthenticatedMerchantApp\(\)/, name);
    assert.match(source, /["']?Cache-Control["']?:\s*["']no-store["']/, name);
  }
  assert.match(create, /createPayoutBatch\(auth\.restaurantId\)/);
  assert.match(approve, /normalizePayoutReference/);
  assert.match(approve, /normalizePayoutChecksum\(body\.checksum\)/);
  assert.match(approve, /approvePayoutBatch\(auth\.restaurantId, reference, checksum\)/);
  assert.match(store, /alreadyAllocated: loaded\.allocated/);
  assert.match(store, /merchantPayoutOutbox\)\.values/);
  assert.match(store, /assertPayoutBatchTransition\(batch\.status as PayoutBatchStatus, "APPROVED"\)/);
  assert.doesNotMatch(store, /\bfetch\s*\(/);
  assert.doesNotMatch(store, /razorpay/i);
});

test("payout ledger schema and migration pin the double-pay guard", () => {
  const schema = readFileSync(join(process.cwd(), "src/db/schema.ts"), "utf8");
  const migrationPath = join(process.cwd(), "src/db/migrations/20261128_merchant_payout_ledger.sql");
  assert.equal(existsSync(migrationPath), true);
  const migration = readFileSync(migrationPath, "utf8");
  for (const table of [
    "merchantPayoutSettings",
    "merchantPayoutBatches",
    "merchantPayoutBatchLines",
    "merchantPayoutOutbox",
    "merchantPayoutEvents",
  ]) {
    assert.match(schema, new RegExp(`export const ${table} = pgTable`));
  }
  assert.match(migration, /merchant_payout_lines_restaurant_settlement_idx/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS/);
  assert.doesNotMatch(migration, /\bUPDATE\s+public\./i);
});
