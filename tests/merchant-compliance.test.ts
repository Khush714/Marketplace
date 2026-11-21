import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  maskPayout,
  MerchantComplianceInputError,
  normalizePayoutInput,
  notConfiguredPayout,
  payoutDto,
  toComplianceInvoice,
} from "../src/lib/merchant-compliance";

function project(relative: string): string {
  const file = join(process.cwd(), relative);
  assert.equal(existsSync(file), true, `${relative} should exist`);
  return readFileSync(file, "utf8");
}

test("UPI destinations are validated and masked before storage", () => {
  const input = normalizePayoutInput({ method: "upi", upiId: "merchant@bank" });
  assert.deepEqual(input, { method: "upi", upiId: "merchant@bank" });
  assert.equal(maskPayout(input), "UPI me***@bank");
  assert.throws(() => normalizePayoutInput({ method: "upi", upiId: "not-an-upi" }), MerchantComplianceInputError);
});

test("bank destinations normalise the IFSC and never expose the full account", () => {
  const input = normalizePayoutInput({
    method: "bank", accountHolderName: "Verde Kitchen", accountNumber: "1234567890", ifsc: "hdfc0001234",
  });
  assert.equal(input.method, "bank");
  assert.equal(maskPayout(input), "Bank ••••7890 (HDFC0001234)");
  assert.equal(JSON.stringify(maskPayout(input)).includes("1234567890"), false);
  assert.throws(() => normalizePayoutInput({ method: "bank", accountHolderName: "V", accountNumber: "123", ifsc: "BAD" }), MerchantComplianceInputError);
});

test("payout DTOs match the Merchant status vocabulary and always carry an ISO time", () => {
  assert.deepEqual(notConfiguredPayout(new Date("2026-11-20T10:00:00.000Z")), {
    status: "not_configured", methodLabel: "", reference: "", updatedAt: "2026-11-20T10:00:00.000Z",
  });
  const dto = payoutDto({
    status: "verified", maskedLabel: "UPI me***@bank", reference: "po_1",
    updatedAt: new Date("2026-11-20T11:00:00.000Z"),
  });
  assert.equal(dto.status, "verified");
  assert.equal(dto.reference, "po_1");
  assert.equal(Number.isNaN(Date.parse(dto.updatedAt)), false);
  assert.equal(payoutDto({ status: "magic", maskedLabel: "x", reference: null, updatedAt: new Date() }).status, "configured");
});

test("invoices use settled money, zero invented tax, and Merchant status vocabulary", () => {
  const source = {
    paymentReference: "pay_1", currency: "inr", settlementStatus: "paid" as const,
    netPaise: 48_500, orderCode: "CRV-5KKQH", customerName: "Guest",
    issuedAt: new Date("2026-11-18T10:00:00.000Z"), updatedAt: new Date("2026-11-18T10:05:00.000Z"),
  };
  const invoice = toComplianceInvoice(source);
  assert.equal(invoice.invoiceNumber, "pay_1");
  assert.equal(invoice.orderId, "CRV-5KKQH");
  assert.equal(invoice.taxableAmount, 48_500);
  assert.equal(invoice.totalAmount, 48_500);
  for (const key of ["cgstAmount", "sgstAmount", "igstAmount"] as const) assert.equal(invoice[key], 0);
  assert.equal(invoice.currency, "INR");
  assert.equal(invoice.status, "issued");
  assert.equal(toComplianceInvoice({ ...source, settlementStatus: "reversed", netPaise: -1_500 }).status, "cancelled");
  assert.equal(toComplianceInvoice({ ...source, netPaise: -1_500 }).totalAmount, 0);
});

test("the payout route is budgeted, authenticated, writable, and dynamic", () => {
  const route = project("src/app/api/integration/merchant/compliance/payout/route.ts");
  assert.match(route, /guardBudget\(req, "merchantServiceRead"\)/);
  assert.match(route, /guardBudget\(req, "merchantServiceWrite"\)/);
  assert.match(route, /authenticateMerchantApp\(req\)/);
  assert.match(route, /unauthenticatedMerchantApp\(\)/);
  assert.match(route, /normalizePayoutInput\(parsed\.body\)/);
  assert.match(route, /savePayoutAccount\(auth\.restaurantId, input\)/);
  assert.match(route, /ok: true, payout/);
  assert.match(route, /Cache-Control": "no-store"/);
  assert.match(route, /export const dynamic = "force-dynamic"/);
});

test("the invoice route is budgeted, authenticated, date-ranged, and dynamic", () => {
  const route = project("src/app/api/integration/merchant/compliance/invoices/route.ts");
  assert.match(route, /guardBudget\(req, "merchantServiceRead"\)/);
  assert.match(route, /authenticateMerchantApp\(req\)/);
  assert.match(route, /unauthenticatedMerchantApp\(\)/);
  assert.match(route, /normalizeMerchantRevenueRange\(/);
  assert.match(route, /listComplianceInvoices\(auth\.restaurantId, range\)/);
  assert.match(route, /ok: true, invoices/);
  assert.match(route, /Cache-Control": "no-store"/);
  assert.match(route, /export const dynamic = "force-dynamic"/);
});

test("the new schema and migration store only sealed payout destinations", () => {
  const schema = project("src/db/schema.ts");
  assert.match(schema, /export const merchantPayoutAccounts = pgTable\(\s*"merchant_payout_accounts"/);
  const migration = project("src/db/migrations/20261125_merchant_compliance_payout.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.merchant_payout_accounts/);
  assert.match(migration, /encrypted_destination text NOT NULL/);
  assert.match(migration, /REFERENCES public\.restaurants\(id\) ON DELETE CASCADE/);
});
