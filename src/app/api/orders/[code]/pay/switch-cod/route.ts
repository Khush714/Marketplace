import { NextRequest } from "next/server";

import { getOrderByCode } from "@/db/queries";
import { getActivePaymentByOrder, switchPendingOnlinePaymentToCash } from "@/db/payments";
import { enqueuePosDelivery } from "@/integrations/pos/order-bridge";
import { guardWrite } from "@/lib/abuse";
import { orderAuthorized } from "@/lib/order-authorized";

export const dynamic = "force-dynamic";

/**
 * Switch a failed/unpaid online order to cash-on-delivery.
 * Only allowed when no money has been captured. The order becomes COD/UNPAID
 * and is enqueued for POS delivery (same as a COD checkout).
 * POST /api/orders/[code]/pay/switch-cod
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const blocked = await guardWrite(req, "paymentSwitch");
  if (blocked) return blocked;

  const { code } = await ctx.params;
  if (!(await orderAuthorized(req, code))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const order = await getOrderByCode(code);
  if (!order) return Response.json({ error: "Not found" }, { status: 404 });

  const result = await switchPendingOnlinePaymentToCash(order);
  if (!result.ok) {
    const status =
      result.code === "PAYMENT_ALREADY_CAPTURED" ? 409 : 400;
    return Response.json({ ok: false, error: result.error, code: result.code }, { status });
  }

  // If we switched to COD, enqueue POS delivery like a normal COD checkout.
  if (result.switched) {
    await enqueuePosDelivery(order.id);
  }

  const payment = await getActivePaymentByOrder(order.id);
  return Response.json({
    ok: true,
    switched: result.switched,
    paymentMethod: "cod",
    paymentStatus: "UNPAID",
    reference: payment?.reference ?? result.reference,
  });
}
