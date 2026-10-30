import { getOrderByCode } from "@/db/queries";
import { toPublicOrder } from "@/lib/order-public";
import { readOrderToken, verifyOrderToken } from "@/lib/order-token";
import { guardRead } from "@/lib/abuse";
import { notFound } from "@/lib/security/errors";

export const dynamic = "force-dynamic";

/**
 * Customer order tracking. Access needs the order's signed token (minted at
 * checkout), and the response is the customer-safe projection only — never the
 * numeric internal id, the restaurant id, the POS external order id, or phone.
 */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  if (!verifyOrderToken(code, readOrderToken(req.headers))) {
    return notFound("Not found");
  }
  const throttled = guardRead(req, "orderLookup");
  if (throttled) return throttled;
  const order = await getOrderByCode(code);
  if (!order) return notFound("Not found");
  return Response.json({ order: toPublicOrder(order) });
}