import { NextRequest } from "next/server";
import { computeBill } from "@/db/queries";

export const dynamic = "force-dynamic";

// Authoritative bill preview for the payment screen. Uses the exact same code
// path as createOrder, so the amount shown, charged and receipted always match.
export async function POST(req: NextRequest) {
  let body: { restaurantSlug?: unknown; items?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
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
  if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: 400 });
  return Response.json({ ok: true, bill: result.bill });
}