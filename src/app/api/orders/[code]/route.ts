import { getOrderByCode } from "@/db/queries";
import { toPublicOrder } from "@/lib/order-public";
import { readOrderToken, verifyOrderToken } from "@/lib/order-token";

export const dynamic = "force-dynamic";

/**
 * Customer order tracking. Access needs the order's signed token (minted at
 * checkout), and the response is the customer-safe projection only — never the
 * numeric internal id, the restaurant id, the POS external order id, or phone.
 */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  if (!verifyOrderToken(code, readOrderToken(req.headers))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const order = await getOrderByCode(code);
  if (!order) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ order: toPublicOrder(order) });
}
