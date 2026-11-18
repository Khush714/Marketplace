/**
 * The Merchant App proxies its Offers screen to the Marketplace. The parser is
 * the trust boundary for that proxy: a modified client must not be able to
 * store a malformed promotion even though the Merchant App also validates.
 *
 * Run with: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateMerchantOffer,
  merchantOfferDiscountCents,
  merchantOfferDto,
  parseMerchantOfferInput,
  parseOfferCode,
  publicMerchantOfferDto,
  type MerchantOfferRow,
} from "../src/lib/merchant-offer";

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    code: " welcome20 ",
    title: "20% off your first order",
    description: "New customers only",
    discountType: "percent",
    value: 20,
    minOrder: 20000,
    maxDiscount: 12000,
    startsAt: null,
    endsAt: null,
    usageLimit: 100,
    active: true,
    ...overrides,
  };
}

test("normalises a valid promotion and caps are preserved", () => {
  const input = parseMerchantOfferInput(validBody());
  assert.equal(input.code, "WELCOME20");
  assert.equal(input.discountType, "percent");
  assert.equal(input.value, 20);
  assert.equal(input.maxDiscount, 12000);
  assert.equal(input.usageLimit, 100);
  assert.equal(input.active, true);
});

test("rejects out-of-range and malformed values", () => {
  assert.throws(() => parseMerchantOfferInput(validBody({ code: "ab" })), /3–40/);
  assert.throws(() => parseMerchantOfferInput(validBody({ code: "bad code" })), /3–40/);
  assert.throws(() => parseMerchantOfferInput(validBody({ value: 101 })), /1% and 100%/);
  assert.throws(() => parseMerchantOfferInput(validBody({ value: 1.5 })), /1% and 100%/);
  assert.throws(() => parseMerchantOfferInput(validBody({ discountType: "flat", value: 99 })), /₹1 and ₹100,000/);
  assert.throws(() => parseMerchantOfferInput(validBody({ minOrder: -1 })), /minimum order/);
  assert.throws(() => parseMerchantOfferInput(validBody({ usageLimit: 0 })), /usage limit/);
  assert.throws(() => parseMerchantOfferInput(validBody({ startsAt: "not-a-date" })), /start date/);
  assert.throws(() => parseMerchantOfferInput(validBody({
    startsAt: "2026-01-02T00:00:00.000Z", endsAt: "2026-01-01T00:00:00.000Z",
  })), /end date/);
});

test("null optionals stay null; dates are emitted as ISO strings", () => {
  const input = parseMerchantOfferInput(validBody({ maxDiscount: "", usageLimit: "", endsAt: "" }));
  assert.equal(input.maxDiscount, null);
  assert.equal(input.usageLimit, null);
  assert.equal(input.endsAt, null);
});

test("DTO matches the Merchant App offer contract", () => {
  const now = new Date("2026-11-18T10:00:00.000Z");
  const dto = merchantOfferDto({
    id: "9b2c2f1e-4a0e-4a1f-9d76-0c2b7c64e123",
    code: "WELCOME20", title: "Welcome", description: "", discountType: "flat",
    value: 5000, minOrder: 0, maxDiscount: null, startsAt: null, endsAt: null,
    usageLimit: null, active: true, archived: false, createdAt: now, updatedAt: now,
  }, "business-1");
  assert.equal(dto.id, "9b2c2f1e-4a0e-4a1f-9d76-0c2b7c64e123");
  assert.equal(dto.businessId, "business-1");
  assert.equal(dto.discountType, "flat");
  assert.equal(dto.createdAt, now.toISOString());
  assert.equal(dto.redemptions, 0);
});

function customerOfferRow(overrides: Partial<MerchantOfferRow> = {}): MerchantOfferRow {
  const now = new Date("2026-11-18T10:00:00.000Z");
  return {
    id: "9b2c2f1e-4a0e-4a1f-9d76-0c2b7c64e123",
    code: "WELCOME20",
    title: "Welcome offer",
    description: "For first orders",
    discountType: "percent",
    value: 20,
    minOrder: 20_000,
    maxDiscount: 12_000,
    startsAt: null,
    endsAt: null,
    usageLimit: 100,
    active: true,
    archived: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("customer codes are normalised but never silently rewritten", () => {
  assert.equal(parseOfferCode(" welcome20 "), "WELCOME20");
  assert.equal(parseOfferCode("WELCOME-20"), "WELCOME-20");
  for (const bad of ["ab", "bad code", "DROP ALL", "", null, 12345]) {
    assert.equal(parseOfferCode(bad), null, `${String(bad)} must not resolve`);
  }
});

test("merchant discounts are computed from the row and capped both ways", () => {
  const percent = customerOfferRow();
  assert.equal(merchantOfferDiscountCents(percent, 50_000), 10_000);
  assert.equal(merchantOfferDiscountCents(percent, 100_000), 12_000, "maxDiscount still wins");

  const flat = customerOfferRow({ discountType: "flat", value: 30_000, maxDiscount: null });
  assert.equal(merchantOfferDiscountCents(flat, 50_000), 30_000);
  assert.equal(merchantOfferDiscountCents(flat, 10_000), 10_000, "a discount cannot exceed the subtotal");
});

test("offer eligibility checks schedule, usage and minimum order", () => {
  const now = new Date("2026-11-18T10:00:00.000Z");
  const row = customerOfferRow();

  assert.deepEqual(evaluateMerchantOffer(row, 0, 50_000, now), { ok: true, discountCents: 10_000 });
  const tooSmall = evaluateMerchantOffer(row, 0, 10_000, now);
  assert.equal(tooSmall.ok === false && tooSmall.code, "MIN_ORDER_NOT_MET");

  const exhausted = evaluateMerchantOffer(row, 100, 50_000, now);
  assert.equal(exhausted.ok === false && exhausted.code, "OFFER_EXHAUSTED");
  const future = evaluateMerchantOffer(
    customerOfferRow({ startsAt: new Date("2026-12-01T00:00:00.000Z") }),
    0, 50_000, now,
  );
  assert.equal(future.ok === false && future.code, "OFFER_NOT_STARTED");
  const past = evaluateMerchantOffer(
    customerOfferRow({ endsAt: new Date("2026-11-01T00:00:00.000Z") }),
    0, 50_000, now,
  );
  assert.equal(past.ok === false && past.code, "OFFER_ENDED");
});

test("public DTO shows the code and terms without trusting the browser", () => {
  const now = new Date("2026-11-18T10:00:00.000Z");
  const dto = publicMerchantOfferDto(customerOfferRow(), 42, now);
  assert.equal(dto.code, "WELCOME20");
  assert.equal(dto.discountLabel, "20% off");
  assert.equal(dto.minOrderCents, 20_000);
  assert.equal(dto.redemptions, 42);
  assert.equal(dto.remainingUses, 58);
  assert.equal(dto.available, true);
  assert.equal("businessId" in dto, false);

  const exhausted = publicMerchantOfferDto(customerOfferRow({ usageLimit: 42 }), 42, now);
  assert.equal(exhausted.available, false);
  assert.equal(exhausted.unavailableReason, "This offer has reached its usage limit.");
});
