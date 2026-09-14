import { placeOrder } from "@/lib/marketplace";
import { safeJson, errorJson } from "@/lib/api";
import { getCurrentCustomer } from "@/lib/session";
import { db } from "@/db";
import { idempotencyKeys } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  marketplaceOrderingEnabled,
  ORDERING_DISABLED_MESSAGE,
} from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

/**
 * POST /api/marketplace/orders
 *
 * PRESERVED (Phase 20). The full ordering pipeline — validation, POS-priced
 * lines, modifiers, tax/discount, idempotency, lifecycle event, notifications
 * — is intact and reachable by setting MARKETPLACE_ORDERING_ENABLED=1.
 *
 * Default product direction is discovery-only: customers order directly from
 * the restaurant via its menu link, so this returns 410 unless re-enabled.
 */
export async function POST(request: Request) {
  if (!marketplaceOrderingEnabled) {
    return errorJson(ORDERING_DISABLED_MESSAGE, 410);
  }

  try {
    const body = await request.json();
    const me = await getCurrentCustomer();

    // Idempotent order creation, atomic under concurrency. We RESERVE the key
    // first; the winner writes the response, the loser replays it.
    const idempotencyKey =
      typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
        ? body.idempotencyKey.trim().slice(0, 80)
        : null;

    if (idempotencyKey) {
      const reserved = await db
        .insert(idempotencyKeys)
        .values({
          key: idempotencyKey,
          customerId: me?.id ?? null,
          responseStatus: 0,
          responseBody: "",
        })
        .onConflictDoNothing()
        .returning({ key: idempotencyKeys.key });

      if (reserved.length === 0) {
        for (let i = 0; i < 40; i++) {
          const [row] = await db
            .select()
            .from(idempotencyKeys)
            .where(eq(idempotencyKeys.key, idempotencyKey))
            .limit(1);
          if (row && row.responseBody && row.responseStatus) {
            return Response.json(JSON.parse(row.responseBody), {
              status: row.responseStatus,
            });
          }
          await new Promise((r) => setTimeout(r, 25));
        }
        return errorJson(
          "A request with this idempotency key is still in progress.",
          409,
        );
      }
    }

    const result = await placeOrder({
      restaurant: String(body.restaurant ?? body.restaurantSlug ?? ""),
      customerId: me?.id ?? null,
      customerName: String(body.customerName ?? me?.name ?? ""),
      customerPhone: String(body.customerPhone ?? me?.phone ?? ""),
      customerAddress: body.customerAddress,
      fulfillmentType: body.fulfillmentType === "pickup" ? "pickup" : "delivery",
      paymentMethod: body.paymentMethod === "card" ? "card" : "cash",
      notes: typeof body.notes === "string" ? body.notes : "",
      discountCode:
        typeof body.discountCode === "string" && body.discountCode.trim()
          ? body.discountCode
          : undefined,
      items: Array.isArray(body.items) ? body.items : [],
      // PHASE 30 — dropoff fix captured at checkout feeds the rider map
      // destination; without these, placeOrder never sees them.
      dropoffLat:
        body.dropoffLat == null || body.dropoffLat === ""
          ? null
          : Number(body.dropoffLat),
      dropoffLng:
        body.dropoffLng == null || body.dropoffLng === ""
          ? null
          : Number(body.dropoffLng),
      scheduledFor:
        typeof body.scheduledFor === "string" && body.scheduledFor
          ? body.scheduledFor
          : null,
    });

    if (!result.ok) return errorJson(result.error, result.status);

    if (idempotencyKey) {
      await db
        .update(idempotencyKeys)
        .set({
          customerId: me?.id ?? null,
          reference: result.reference,
          responseStatus: 201,
          responseBody: JSON.stringify(result),
        })
        .where(eq(idempotencyKeys.key, idempotencyKey));
    }

    return safeJson(result, 201);
  } catch (e) {
    console.error(e);
    return errorJson("Failed to place order", 500);
  }
}
