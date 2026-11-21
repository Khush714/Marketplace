import { requestCustomerCancellation } from "@/integrations/pos/order-cancel";
import { orderAuthorized } from "@/lib/order-authorized";
import { guardWrite } from "@/lib/abuse";

export const dynamic = "force-dynamic";

/**
 * Customer-initiated cancellation, POST /api/orders/[code]/cancel.
 *
 * The POS decides (authoritative): this route only forwards a signed
 * order.cancelled request and reflects the POS's EXPLICIT response. The
 * orders.integration_status is flipped by the POS's order.cancelled status
 * webhook — never here — so the two systems never diverge.
 *
 * Cancelling needs a signed order token or a live customer session bound to
 * the order code.
 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const blocked = await guardWrite(req, "orderCancel");
  if (blocked) return blocked;

  const { code } = await ctx.params;
  if (!(await orderAuthorized(req, code))) {
    return Response.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  const outcome = await requestCustomerCancellation(code);

  if (outcome.kind === "cancelled") {
    return Response.json({
      ok: true,
      cancelled: true,
      idempotent: outcome.idempotent,
      status: outcome.status,
    });
  }
  if (outcome.kind === "pending") {
    return Response.json({
      ok: true,
      cancelled: false,
      pending: true,
      status: outcome.status,
    });
  }

  const status =
    outcome.code === "ORDER_NOT_FOUND"
      ? 404
      : outcome.code === "POS_UNREACHABLE"
        ? 503
        : 409;
  return Response.json(
    { ok: false, cancelled: false, code: outcome.code, reason: outcome.reason, currentStatus: outcome.currentStatus },
    { status },
  );
}