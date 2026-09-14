import { NextRequest } from "next/server";
import { db } from "@/db";
import { payments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { safeJson, errorJson } from "@/lib/api";
import { computeMarketplacePricing } from "@/lib/marketplace";
import {
  createRazorpayOrder,
  requiresRazorpay,
  RAZORPAY_KEY_ID,
  toPaise,
} from "@/lib/razorpay";

export const dynamic = "force-dynamic";

/**
 * POST /api/payments/create-order
 *
 * Step 1 of the Razorpay checkout flow (pay-first). The client submits the
 * full cart + customer details. We:
 *
 *   1. Price it server-side via the same `computeMarketplacePricing` the
 *      order-placement path uses (single pricing authority).
 *   2. Create a Razorpay order for that exact amount.
 *   3. Record a `payments` intent row (orderId is NULL — the marketplace
 *      order is created only after payment succeeds, by POST /verify).
 *   4. Return `{ razorpayOrderId, reference, amountInr }` for the client
 *      checkout to open.
 *
 * Body:
 *   restaurant (slug|id), customerName, customerPhone, customerAddress,
 *   fulfillmentType, notes?, discountCode?, items[{menuItemId, quantity, modifierIds?}]
 */
export async function POST(request: NextRequest) {
  const missing = requiresRazorpay();
  if (missing) return errorJson(missing, 503);

  try {
    const body = await request.json();

    // Pre-flight the exact same inputs placeOrder will use after payment,
    // and get the authoritative price + a fresh reference for the order.
    const priced = await computeMarketplacePricing({
      restaurant: String(body.restaurant ?? body.restaurantSlug ?? ""),
      customerId:
        typeof body.customerId === "number" ? body.customerId : undefined,
      customerName: String(body.customerName ?? ""),
      customerPhone: String(body.customerPhone ?? ""),
      customerAddress: body.customerAddress,
      dropoffLat:
        body.dropoffLat == null || body.dropoffLat === ""
          ? null
          : Number(body.dropoffLat),
      dropoffLng:
        body.dropoffLng == null || body.dropoffLng === ""
          ? null
          : Number(body.dropoffLng),
      fulfillmentType: body.fulfillmentType === "pickup" ? "pickup" : "delivery",
      paymentMethod: "card",
      notes: typeof body.notes === "string" ? body.notes : "",
      discountCode:
        typeof body.discountCode === "string" && body.discountCode.trim()
          ? body.discountCode
          : undefined,
      items: Array.isArray(body.items) ? body.items : [],
      reference: typeof body.reference === "string" ? body.reference : undefined,
      scheduledFor:
        typeof body.scheduledFor === "string" && body.scheduledFor
          ? body.scheduledFor
          : null,
    });

    if (!priced.ok) return errorJson(priced.error, priced.status);

    const { quote } = priced;

    // Create the Razorpay order for the exact quoted total.
    const rzr = await createRazorpayOrder({
      amountInr: quote.pricing.total,
      reference: quote.reference,
      customerName: quote.customerName,
      customerPhone: quote.customerPhone,
    });

    if (!rzr.ok) return errorJson(rzr.error, 502);

    // Record the intent so a later verify/webhook can reconcile it. If the
    // customer retries (idempotent by reference), update the existing row.
    await db
      .insert(payments)
      .values({
        reference: quote.reference,
        razorpayOrderId: rzr.razorpayOrderId,
        amount: quote.pricing.total.toFixed(2),
        currency: rzr.currency,
        status: "created",
        metadata: JSON.stringify({
          restaurantId: quote.restaurant.id,
          customerName: quote.customerName,
          customerPhone: quote.customerPhone,
          customerId: typeof body.customerId === "number" ? body.customerId : null,
          cart: body.items,
          notes: body.notes ?? "",
          discountCode: body.discountCode ?? null,
          customerAddress: quote.customerAddress,
          dropoffLat: quote.dropoff ? quote.dropoff.lat : null,
          dropoffLng: quote.dropoff ? quote.dropoff.lng : null,
          fulfillmentType: quote.fulfillmentType,
          scheduledFor: quote.scheduledFor
            ? quote.scheduledFor.toISOString()
            : null,
        }),
      })
      .onConflictDoUpdate({
        target: payments.reference,
        set: {
          razorpayOrderId: rzr.razorpayOrderId,
          amount: quote.pricing.total.toFixed(2),
          currency: rzr.currency,
          status: "created",
        },
      });

    return safeJson({
      ok: true,
      razorpayOrderId: rzr.razorpayOrderId,
      keyId: RAZORPAY_KEY_ID,
      reference: quote.reference,
      amountInr: quote.pricing.total,
      amountPaise: toPaise(quote.pricing.total),
      currency: rzr.currency ?? "INR",
    });
  } catch (e) {
    console.error("POST /api/payments/create-order", e);
    return errorJson("Failed to create payment", 500);
  }
}