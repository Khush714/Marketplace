import { listPublicMerchantOffersForSlug } from "@/db/merchant-offers";
import { guardRead } from "@/lib/abuse";

export const dynamic = "force-dynamic";

/**
 * Customer-facing view of the Merchant App's offer library. Codes are public by
 * design — the whole point is that a shopper can pick one at checkout — but the
 * discount is never accepted from this payload: checkout re-resolves the row and
 * recalculates it server-side from the order's actual subtotal.
 */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const throttled = guardRead(req, "merchantOffers");
  if (throttled) return throttled;

  const { slug } = await ctx.params;
  const offers = await listPublicMerchantOffersForSlug(slug);
  return Response.json(
    { offers },
    { headers: { "Cache-Control": "no-store" } },
  );
}
