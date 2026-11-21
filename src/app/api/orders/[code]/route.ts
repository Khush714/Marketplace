import { getOrderByCode } from "@/db/queries";
import { toPublicOrder } from "@/lib/order-public";
import { orderAuthorized } from "@/lib/order-authorized";
import { guardRead } from "@/lib/abuse";

export const dynamic = "force-dynamic";

/**
 * Customer order tracking. Access needs a signed order token (minted at
 * checkout) or a live customer session bound to this order code. The response
 * is the customer-safe projection only — never internal ids or phone.
 */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const throttled = guardRead(req, "orderLookup");
  if (throttled) return throttled;
  if (!(await orderAuthorized(req, code))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const order = await getOrderByCode(code);
  if (!order) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ order: toPublicOrder(order) });
}