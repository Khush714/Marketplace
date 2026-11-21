import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  MERCHANT_SETTLEMENT_MAX_PAGE,
  merchantSettlementStatus,
  normalizeMerchantSettlementPage,
  toMerchantSettlement,
  type MerchantSettlementSource,
} from "../src/lib/merchant-settlements";

function source(overrides: Partial<MerchantSettlementSource> = {}): MerchantSettlementSource {
  return {
    paymentReference: "pay_settlement_1",
    providerPaymentId: "prov_payment_1",
    currency: "INR",
    status: "PAID",
    signatureVerified: true,
    amountCents: 50_000,
    refundedAmountCents: 0,
    capturedAt: new Date("2026-11-18T10:00:00.000Z"),
    updatedAt: new Date("2026-11-18T10:05:00.000Z"),
    order: { id: 2847, code: "CRV-5KKQH", platformFeeCents: 1_500 },
    ...overrides,
  };
}

test("paid settlements use the verified payment amount minus commission", () => {
  const row = toMerchantSettlement(source());
  assert.equal(row.status, "paid");
  assert.equal(row.externalId, "payment:pay_settlement_1");
  assert.equal(row.marketplaceOrderId, "CRV-5KKQH");
  assert.equal(row.orderNumber, 2847);
  assert.equal(row.grossPaise, 50_000);
  assert.equal(row.commissionPaise, 1_500);
  assert.equal(row.refundPaise, 0);
  assert.equal(row.netPaise, 48_500);
  assert.equal(row.paidAt, "2026-11-18T10:00:00.000Z");
  assert.equal(row.updatedAt, "2026-11-18T10:05:00.000Z");
});

test("an unverified capture is never reported as confirmed money", () => {
  const row = toMerchantSettlement(source({ signatureVerified: false }));
  assert.equal(row.status, "pending");
  assert.equal(row.paidAt, null);
});

test("partial refunds stay paid but reduce the net amount", () => {
  const row = toMerchantSettlement(source({ status: "PARTIALLY_REFUNDED", refundedAmountCents: 10_000 }));
  assert.equal(row.status, "paid");
  assert.equal(row.refundPaise, 10_000);
  assert.equal(row.netPaise, 38_500);
});

test("complete refunds are reversed and do not require a paid-at timestamp", () => {
  const row = toMerchantSettlement(source({ status: "REFUNDED", refundedAmountCents: 50_000 }));
  assert.equal(row.status, "reversed");
  assert.equal(row.refundPaise, 50_000);
  assert.equal(row.netPaise, -1_500);
  assert.equal(row.paidAt, null);
});

test("payment lifecycle statuses map to the Merchant settlement vocabulary", () => {
  assert.equal(merchantSettlementStatus("PAYMENT_PENDING"), "pending");
  assert.equal(merchantSettlementStatus("UNPAID"), "pending");
  assert.equal(merchantSettlementStatus("PAYMENT_CANCELLED"), "failed");
  assert.equal(merchantSettlementStatus("FAILED"), "failed");
  assert.equal(merchantSettlementStatus("REFUND_PENDING"), "paid");
});

test("hostile page values collapse to a bounded page number", () => {
  assert.equal(normalizeMerchantSettlementPage(null), 1);
  assert.equal(normalizeMerchantSettlementPage("not-a-number"), 1);
  assert.equal(normalizeMerchantSettlementPage("0"), 1);
  assert.equal(normalizeMerchantSettlementPage("-2"), 1);
  assert.equal(normalizeMerchantSettlementPage("3"), 3);
  assert.equal(normalizeMerchantSettlementPage("999"), MERCHANT_SETTLEMENT_MAX_PAGE);
});

test("the settlement route is authenticated, budgeted, paginated, and dynamic", () => {
  const route = join(process.cwd(), "src/app/api/integration/merchant/settlements/route.ts");
  assert.equal(existsSync(route), true);
  const text = readFileSync(route, "utf8");
  assert.match(text, /guardBudget\(req, "merchantServiceRead"\)/);
  assert.match(text, /authenticateMerchantApp\(req\)/);
  assert.match(text, /unauthenticatedMerchantApp\(\)/);
  assert.match(text, /normalizeMerchantSettlementPage\(req\.nextUrl\.searchParams\.get\("page"\)\)/);
  assert.match(text, /listMerchantSettlements\(auth\.restaurantId, \{ page \}\)/);
  assert.match(text, /ok: true, \.\.\.result/);
  assert.match(text, /export const dynamic = "force-dynamic"/);
});
