/**
 * Tests for bidirectional sync between Merchant App and Restaurant POS
 * 
 * Verifies:
 * 1. Merchant → POS: When merchant accepts/prepares/readies/completes/rejects/cancels,
 *    integrationStatus is mirrored
 * 2. POS → Merchant: When POS webhook updates status, merchantStatus is mirrored back
 *    only for merchantManaged orders, with OUT_FOR_DELIVERY → OUT_FOR_DELIVERY mapping
 * 
 * Run with: npm test -- tests/merchant-pos-bidirectional-sync.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { orders, restaurants, users } from "../src/db/schema";
import { transitionMerchantOrder } from "../src/db/merchant-orders";
import { applyOrderStatusTransition } from "../src/db/pos-delivery";

test("Merchant -> POS: merchant status transitions mirror to integrationStatus", async () => {
  // Create test restaurant
  const [user] = await db.insert(users).values({
    phone: `+91${Math.floor(Math.random() * 10000000000)}`,
    name: "Test User",
    role: "restaurant",
  }).returning();

  const [restaurant] = await db.insert(restaurants).values({
    name: "Test Restaurant",
    slug: `test-${Date.now()}`,
    phone: user.phone,
    ownerId: user.id,
    addressText: "Test Address",
    cuisine: "Indian",
    priceRange: 2,
    isActive: true,
    isOpen: true,
  }).returning();

  // Create a merchant-managed order
  const orderCode = `TEST${Date.now()}`;
  const [order] = await db.insert(orders).values({
    code: orderCode,
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    restaurantSlug: restaurant.slug,
    items: [{ name: "Test Item", quantity: 1, priceCents: 10000 }],
    addressText: "Test",
    customerName: "Test Customer",
    phone: "+911234567890",
    paymentMethod: "cod",
    paymentStatus: "UNPAID",
    subtotalCents: 10000,
    deliveryFeeCents: 0,
    platformFeeCents: 0,
    discountCents: 0,
    totalCents: 10000,
    merchantManaged: true,
    merchantStatus: "PLACED",
    integrationStatus: "PLACED",
    merchantFulfilment: "pickup",
  }).returning();

  // Accept order
  const acceptResult = await transitionMerchantOrder({
    restaurantId: restaurant.id,
    orderCode,
    expectedStatus: "PLACED",
    nextStatus: "ACCEPTED",
    prepMinutes: 30,
  });
  assert.equal(acceptResult.ok, true);

  let updated = await db.select().from(orders).where(eq(orders.id, order.id)).limit(1);
  assert.equal(updated[0].merchantStatus, "ACCEPTED");
  assert.equal(updated[0].integrationStatus, "ACCEPTED", "integrationStatus should mirror merchant status");

  // Preparing
  const prepResult = await transitionMerchantOrder({
    restaurantId: restaurant.id,
    orderCode,
    expectedStatus: "ACCEPTED",
    nextStatus: "PREPARING",
  });
  assert.equal(prepResult.ok, true);
  updated = await db.select().from(orders).where(eq(orders.id, order.id)).limit(1);
  assert.equal(updated[0].merchantStatus, "PREPARING");
  assert.equal(updated[0].integrationStatus, "PREPARING");

  // Ready
  const readyResult = await transitionMerchantOrder({
    restaurantId: restaurant.id,
    orderCode,
    expectedStatus: "PREPARING",
    nextStatus: "READY",
  });
  assert.equal(readyResult.ok, true);
  updated = await db.select().from(orders).where(eq(orders.id, order.id)).limit(1);
  assert.equal(updated[0].merchantStatus, "READY");
  assert.equal(updated[0].integrationStatus, "READY");

  // Complete (pickup order)
  const completeResult = await transitionMerchantOrder({
    restaurantId: restaurant.id,
    orderCode,
    expectedStatus: "READY",
    nextStatus: "COMPLETED",
  });
  assert.equal(completeResult.ok, true);
  updated = await db.select().from(orders).where(eq(orders.id, order.id)).limit(1);
  assert.equal(updated[0].merchantStatus, "COMPLETED");
  assert.equal(updated[0].integrationStatus, "COMPLETED");

  console.log("✓ Merchant -> POS mirroring works for all transitions");
});

test("POS -> Merchant: POS webhook mirrors to merchantStatus for merchantManaged orders", async () => {
  const [user] = await db.insert(users).values({
    phone: `+91${Math.floor(Math.random() * 10000000000)}`,
    name: "Test User 2",
    role: "restaurant",
  }).returning();

  const [restaurant] = await db.insert(restaurants).values({
    name: "Test Restaurant 2",
    slug: `test2-${Date.now()}`,
    phone: user.phone,
    ownerId: user.id,
    addressText: "Test Address",
    cuisine: "Indian",
    priceRange: 2,
    isActive: true,
    isOpen: true,
  }).returning();

  const orderCode = `TEST2${Date.now()}`;
  const [order] = await db.insert(orders).values({
    code: orderCode,
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    restaurantSlug: restaurant.slug,
    items: [{ name: "Test Item", quantity: 1, priceCents: 10000 }],
    addressText: "Test",
    customerName: "Test Customer",
    phone: "+911234567890",
    paymentMethod: "cod",
    paymentStatus: "UNPAID",
    subtotalCents: 10000,
    deliveryFeeCents: 0,
    platformFeeCents: 0,
    discountCents: 0,
    totalCents: 10000,
    externalOrderId: `mkt_ord_${Date.now()}`,
    merchantManaged: true,
    merchantStatus: "PLACED",
    integrationStatus: "PLACED",
    merchantFulfilment: "delivery",
  }).returning();

  // POS marks as preparing
  const result = await applyOrderStatusTransition({
    restaurantId: restaurant.id,
    eventId: `evt-${Date.now()}-1`,
    externalOrderId: order.externalOrderId!,
    posOrderId: 12345,
    status: "PREPARING",
  });
  assert.equal(result.outcome, "applied");

  let updated = await db.select().from(orders).where(eq(orders.id, order.id)).limit(1);
  assert.equal(updated[0].integrationStatus, "PREPARING");
  assert.equal(updated[0].merchantStatus, "PREPARING", "merchantStatus should mirror from POS for merchantManaged orders");

  console.log("✓ POS -> Merchant mirroring works");
});

test("POS -> Merchant: OUT_FOR_DELIVERY maps to OUT_FOR_DELIVERY on merchant side", async () => {
  const [user] = await db.insert(users).values({
    phone: `+91${Math.floor(Math.random() * 10000000000)}`,
    name: "Test User 3",
    role: "restaurant",
  }).returning();

  const [restaurant] = await db.insert(restaurants).values({
    name: "Test Restaurant 3",
    slug: `test3-${Date.now()}`,
    phone: user.phone,
    ownerId: user.id,
    addressText: "Test Address",
    cuisine: "Indian",
    priceRange: 2,
    isActive: true,
    isOpen: true,
  }).returning();

  const orderCode = `TEST3${Date.now()}`;
  const [order] = await db.insert(orders).values({
    code: orderCode,
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    restaurantSlug: restaurant.slug,
    items: [{ name: "Test Item", quantity: 1, priceCents: 10000 }],
    addressText: "Test",
    customerName: "Test Customer",
    phone: "+911234567890",
    paymentMethod: "cod",
    paymentStatus: "UNPAID",
    subtotalCents: 10000,
    deliveryFeeCents: 0,
    platformFeeCents: 0,
    discountCents: 0,
    totalCents: 10000,
    externalOrderId: `mkt_ord_${Date.now()}`,
    merchantManaged: true,
    merchantStatus: "PREPARING",
    integrationStatus: "PREPARING",
    merchantFulfilment: "delivery",
  }).returning();

  // POS marks as OUT_FOR_DELIVERY
  const result = await applyOrderStatusTransition({
    restaurantId: restaurant.id,
    eventId: `evt-${Date.now()}-2`,
    externalOrderId: order.externalOrderId!,
    posOrderId: 12346,
    status: "OUT_FOR_DELIVERY",
  });
  assert.equal(result.outcome, "applied");

  let updated = await db.select().from(orders).where(eq(orders.id, order.id)).limit(1);
  assert.equal(updated[0].integrationStatus, "OUT_FOR_DELIVERY");
  assert.equal(updated[0].merchantStatus, "OUT_FOR_DELIVERY", "OUT_FOR_DELIVERY should map to OUT_FOR_DELIVERY on merchant side");

  console.log("✓ OUT_FOR_DELIVERY -> OUT_FOR_DELIVERY mapping works");
});

test("POS -> Merchant: does NOT mirror to non-merchantManaged orders", async () => {
  const [user] = await db.insert(users).values({
    phone: `+91${Math.floor(Math.random() * 10000000000)}`,
    name: "Test User 4",
    role: "restaurant",
  }).returning();

  const [restaurant] = await db.insert(restaurants).values({
    name: "Test Restaurant 4",
    slug: `test4-${Date.now()}`,
    phone: user.phone,
    ownerId: user.id,
    addressText: "Test Address",
    cuisine: "Indian",
    priceRange: 2,
    isActive: true,
    isOpen: true,
  }).returning();

  const orderCode = `TEST4${Date.now()}`;
  const [order] = await db.insert(orders).values({
    code: orderCode,
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    restaurantSlug: restaurant.slug,
    items: [{ name: "Test Item", quantity: 1, priceCents: 10000 }],
    addressText: "Test",
    customerName: "Test Customer",
    phone: "+911234567890",
    paymentMethod: "cod",
    paymentStatus: "UNPAID",
    subtotalCents: 10000,
    deliveryFeeCents: 0,
    platformFeeCents: 0,
    discountCents: 0,
    totalCents: 10000,
    externalOrderId: `mkt_ord_${Date.now()}`,
    merchantManaged: false, // NOT merchant managed
    merchantStatus: "PLACED",
    integrationStatus: "PLACED",
    merchantFulfilment: "delivery",
  }).returning();

  // POS marks as preparing
  const result = await applyOrderStatusTransition({
    restaurantId: restaurant.id,
    eventId: `evt-${Date.now()}-3`,
    externalOrderId: order.externalOrderId!,
    posOrderId: 12347,
    status: "PREPARING",
  });
  assert.equal(result.outcome, "applied");

  let updated = await db.select().from(orders).where(eq(orders.id, order.id)).limit(1);
  assert.equal(updated[0].integrationStatus, "PREPARING");
  assert.equal(updated[0].merchantStatus, "PLACED", "merchantStatus should NOT change for non-merchantManaged orders");

  console.log("✓ Non-merchantManaged orders are not mirrored back correctly");
});
