import { cancelMerchantOrderByCode } from "@/db/merchant-orders";
import { requestCustomerCancellation } from "@/integrations/pos/order-cancel";
import { guardWrite, readRawBodyCapped } from "@/lib/abuse";
import { MAX_JSON_BODY_BYTES } from "@/lib/abuse-core";
import { parseCancelReason } from "@/lib/checkout-extras-core";
import { orderAuthorized } from "@/lib/order-authorized";

export const dynamic = "force-dynamic";

/**
 * Customer-initiated cancellation, POST /api/orders/[code]/cancel.
 *
 * Merchant-paired orders are cancelled in Marketplace's canonical merchant
 * lifecycle: the status change, event row and payment reversal all happen
 * synchronously in `cancelMerchantOrderByCode`. Legacy POS orders still fall
 * through to the signed POS request, whose authoritative `order.cancelled`
 * status webhook flips `orders.integration_status` — this route never does.
 *
 * Cancelling needs the order's signed token OR a session bound to that code:
 * an order code on its own must not be enough to cancel somebody else's
 * delivery. The guard is charged first — the credential can now ride an
 * HttpOnly cookie, so this write needs the origin check as well as the budget.
 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const blocked = await guardWrite(req, "orderCancel");
  if (blocked) return blocked;
  const { code } = await ctx.params;
  if (!(await orderAuthorized(req, code))) {
    return Response.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  // Older clients POST no body; keep that path valid while accepting a bounded
  // reason from the current UI. An unknown value collapses to `other` server-side.
  let reason = "other";
  const raw = await readRawBodyCapped(req, MAX_JSON_BODY_BYTES);
  if (!raw.ok) return raw.response;
  if (raw.text.trim()) {
    try {
      const body = JSON.parse(raw.text) as { reason?: unknown };
      reason = parseCancelReason(body?.reason);
    } catch {
      return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
    }
  }

  const merchant = await cancelMerchantOrderByCode(code, reason);
  if (merchant.kind !== "NOT_MERCHANT") {
    if (merchant.kind === "NOT_FOUND") {
      return Response.json({ ok: false, cancelled: false, code: "ORDER_NOT_FOUND" }, { status: 404 });
    }
    if (merchant.kind === "CONFLICT") {
      return Response.json(
        {
          ok: false,
          cancelled: false,
          code: "ORDER_NOT_CANCELLABLE",
          reason: "This order can no longer be cancelled",
          currentStatus: merchant.currentStatus,
        },
        { status: 409 },
      );
    }
    return Response.json({
      ok: true,
      cancelled: true,
      idempotent: merchant.idempotent,
      status: merchant.status,
    });
  }

  const outcome = await requestCustomerCancellation(code, reason);

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
