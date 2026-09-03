import { getPublicOrder } from "@/lib/marketplace";
import { safeJson, errorJson } from "@/lib/api";
import {
  marketplaceOrderingEnabled,
  ORDERING_DISABLED_MESSAGE,
} from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

/**
 * GET /api/marketplace/orders/:id — accepts numeric id or reference.
 * PRESERVED (Phase 20); gated by MARKETPLACE_ORDERING_ENABLED.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!marketplaceOrderingEnabled) {
    return errorJson(ORDERING_DISABLED_MESSAGE, 410);
  }

  const { id } = await params;
  try {
    const order = await getPublicOrder(id);
    if (!order) return errorJson("Order not found", 404);
    return safeJson({ order });
  } catch (e) {
    console.error(e);
    return errorJson("Failed to load order", 500);
  }
}
