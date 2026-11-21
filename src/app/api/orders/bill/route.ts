import { NextRequest } from "next/server";
import { computeBill } from "@/db/queries";
import { guardWrite, readJsonBody } from "@/lib/abuse";
import { sanitizeCart } from "@/lib/order-input-core";

export const dynamic = "force-dynamic";

// Authoritative bill preview for the payment screen. Uses the exact same code
// path as createOrder, so the amount shown, charged and receipted always match.
//
// Unauthenticated by design — the customer has not paid yet and has no token —
// but it recomputes every total from the database, so a loop over it is a
// cheap-to-send, expensive-to-serve amplification. Budgeted and size-capped.
export async function POST(req: NextRequest) {
  const blocked = await guardWrite(req, "billPreview");
  if (blocked) return blocked;

  let body: { restaurantSlug?: unknown; items?: unknown };
  {
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    body = parsed.body as { restaurantSlug?: unknown; items?: unknown };
  }

  const restaurantSlug = typeof body?.restaurantSlug === "string" ? body.restaurantSlug.trim() : "";
  if (!restaurantSlug) {
    return Response.json(
      { ok: false, error: "Missing or invalid required fields", code: "MISSING_FIELDS" },
      { status: 400 },
    );
  }

  // Same cart rules as POST /api/orders: empty carts, out-of-range quantities
  // and oversized carts are refused here too, so the amount shown at payment
  // always comes from a cart checkout would actually accept. Unlike the old
  // inline filter this rejects a bad line rather than silently dropping it —
  // a preview that omits a line disagrees with the order it claims to preview.
  const cart = sanitizeCart(body?.items);
  if (!cart.ok) {
    return Response.json({ ok: false, error: cart.error, code: cart.code }, { status: 400 });
  }

  const result = await computeBill(restaurantSlug, cart.items);
  if (!result.ok) {
    // Same status mapping as POST /api/orders: an integration/outlet refusal is
    // 422 (the client's request named a restaurant that cannot take the order),
    // everything else stays a client 400.
    const status =
      result.code === "OUTLET_NOT_MAPPED" || result.code === "INTEGRATION_NOT_CONNECTED" ? 422 : 400;
    return Response.json({ ok: false, error: result.error, code: result.code }, { status });
  }
  return Response.json({ ok: true, bill: result.bill });
}
