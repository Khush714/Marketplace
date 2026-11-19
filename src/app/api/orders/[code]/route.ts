import { getOrderByCode } from "@/db/queries";
import { guardRead } from "@/lib/abuse";
import { orderAuthorized } from "@/lib/order-authorized";
import { toPublicOrder } from "@/lib/order-public";

export const dynamic = "force-dynamic";

/**
 * Customer order tracking. Access is the order's signed token OR a live
 * customer session bound to the code — both are checked by `orderAuthorized`,
 * and a failure is the same 404 as a genuinely missing order. The response is
 * the customer-safe projection only — never the numeric internal id, the
 * restaurant id, the POS external order id, or phone.
 */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const throttled = guardRead(req, "orderLookup");
  if (throttled) return throttled;
  const { code } = await ctx.params;
  if (!(await orderAuthorized(req, code))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const order = await getOrderByCode(code);
  if (!order) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ order: toPublicOrder(order) });
}