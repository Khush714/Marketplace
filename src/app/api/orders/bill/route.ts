import { NextRequest } from "next/server";
import { computeBill } from "@/db/queries";
import { guardWrite, readJsonBody } from "@/lib/abuse";

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

  const restaurantSlug = typeof body?.restaurantSlug === "string" ? body.restaurantSlug : "";
  const items = Array.isArray(body?.items)
    ? body.items
        .filter(
          (raw): raw is { menuItemId: number; quantity: number; priceCents?: number; modifiers?: unknown } =>
            !!raw &&
            typeof raw === "object" &&
            typeof (raw as { menuItemId?: unknown }).menuItemId === "number" &&
            typeof (raw as { quantity?: unknown }).quantity === "number",
        )
        .map((raw) => ({
          menuItemId: raw.menuItemId,
          quantity: raw.quantity,
          priceCents: typeof raw.priceCents === "number" ? raw.priceCents : undefined,
          modifiers: Array.isArray(raw.modifiers)
            ? raw.modifiers
                .filter(
                  (mod): mod is { optionId: number; quantity?: number } =>
                    !!mod &&
                    typeof mod === "object" &&
                    typeof (mod as { optionId?: unknown }).optionId === "number",
                )
                .map((mod) => ({
                  optionId: mod.optionId,
                  quantity: typeof mod.quantity === "number" ? mod.quantity : undefined,
                }))
            : undefined,
        }))
    : [];

  if (!restaurantSlug || items.length === 0) {
    return Response.json(
      { ok: false, error: "Missing or invalid required fields" },
      { status: 400 },
    );
  }

  const result = await computeBill(restaurantSlug, items);
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
