import { getRiderLocationForOrder } from "@/lib/delivery";
import { getPublicOrder } from "@/lib/marketplace";
import { safeJson, errorJson } from "@/lib/api";
import {
  marketplaceOrderingEnabled,
  ORDERING_DISABLED_MESSAGE,
} from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

/**
 * GET /api/marketplace/orders/:reference/location — latest rider position fix.
 *
 * Lightweight REST fallback for the SSE stream: the tracker polls this every
 * ~15s when the events connection is down. The reference is the access
 * credential (same contract as the order GET), so no session is required.
 *
 * Response: `{ rider: { lat, lng, heading, at } | null }`
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!marketplaceOrderingEnabled) {
    return errorJson(ORDERING_DISABLED_MESSAGE, 410);
  }

  const reference = (await params).id.trim();
  try {
    const order = await getPublicOrder(reference);
    if (!order) return errorJson("Order not found", 404);

    const rider = await getRiderLocationForOrder(order.id);
    return safeJson({ rider });
  } catch (e) {
    console.error(e);
    return errorJson("Failed to load rider location", 500);
  }
}