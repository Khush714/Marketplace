import { getPublicOrder } from "@/lib/marketplace";
import { safeJson, errorJson } from "@/lib/api";
import {
  marketplaceOrderingEnabled,
  ORDERING_DISABLED_MESSAGE,
} from "@/lib/feature-flags";
import {
  isNumericReference,
  PUBLIC_ORDER_REFERENCE_RE,
} from "@/lib/order-reference";

export const dynamic = "force-dynamic";

/**
 * GET /api/marketplace/orders/:reference — the customer's own order.
 *
 * PHASE 14 — the reference IS the access credential (high-entropy, CSPRNG).
 * Lookup is reference-only in getPublicOrder — numeric ids are rejected here
 * before they reach the DB so sequential-id enumeration can never return
 * someone else's order (and its delivery + live rider position).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!marketplaceOrderingEnabled) {
    return errorJson(ORDERING_DISABLED_MESSAGE, 410);
  }

  const id = (await params).id.trim().toUpperCase();
  if (!PUBLIC_ORDER_REFERENCE_RE.test(id) || isNumericReference(id)) {
    return errorJson("Order not found", 404);
  }

  try {
    const order = await getPublicOrder(id);
    if (!order) return errorJson("Order not found", 404);
    return safeJson({ order });
  } catch (e) {
    console.error(e);
    return errorJson("Failed to load order", 500);
  }
}