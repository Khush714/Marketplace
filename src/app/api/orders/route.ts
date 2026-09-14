import { placeOrder } from "@/lib/marketplace";
import { safeJson, errorJson } from "@/lib/api";
import {
  marketplaceOrderingEnabled,
  ORDERING_DISABLED_MESSAGE,
} from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

/**
 * POST /api/orders — legacy alias for /api/marketplace/orders.
 *
 * Kept so old integrations/tests keep a stable path, but gated by the SAME
 * MARKETPLACE_ORDERING_ENABLED flag so the in-marketplace ordering pipeline
 * can never be reached through a second, unguarded door.
 */
export async function POST(request: Request) {
  if (!marketplaceOrderingEnabled) {
    return errorJson(ORDERING_DISABLED_MESSAGE, 410);
  }

  try {
    const body = await request.json();
    const result = await placeOrder(body);

    if (!result.ok) {
      return errorJson(result.error, result.status);
    }

    return safeJson(result, 201);
  } catch (e) {
    console.error("POST /api/orders", e);
    return errorJson("Failed to place order", 500);
  }
}
