import { requireAdmin } from "@/lib/admin-auth";
import { getOrderDeliveryStatus } from "@/lib/data";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/orders/[reference]/delivery-status
 *
 * PHASE 16 — Returns the POS delivery status for an order, including the
 * webhook event history (attempts, errors, next retry time).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ reference: string }> },
) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { reference } = await params;
  if (!reference || !reference.startsWith("MKT-")) {
    return Response.json({ error: "Invalid order reference" }, { status: 400 });
  }

  const delivery = await getOrderDeliveryStatus(reference);
  if (!delivery) {
    return Response.json({ error: "Order not found" }, { status: 404 });
  }

  return Response.json({ delivery });
}
