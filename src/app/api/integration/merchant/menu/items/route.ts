import { NextRequest } from "next/server";
import { createMenuItem, deleteMenuItem, getPartnerMenu, setItemModifierGroups, updateMenuItem } from "@/db/partner-menu";
import { guardBudget, readJsonBody } from "@/lib/abuse";
import { authenticateMerchantApp, unauthenticatedMerchantApp } from "@/lib/merchant-app-auth";
import type { PartnerMenuItemDto } from "@/lib/types";

export const dynamic = "force-dynamic";
const ID = /^\d{1,12}$/;
function mapItem(item: PartnerMenuItemDto, businessId: string) {
  return {
    id: String(item.id), businessId, name: item.name, description: item.description,
    price: item.priceCents, category: item.category, imageUrl: item.imageUrl,
    dietary: item.isVeg ? "veg" : "nonveg", available: item.available, archived: false,
    stockQuantity: item.stockQuantity, modifierGroupIds: item.modifierGroupIds,
    posSynced: item.posSynced,
  };
}
async function readPayload(req: NextRequest): Promise<{ auth: { restaurantId: number; businessId: string } } | { response: Response }> {
  const blocked = guardBudget(req, "merchantServiceRead");
  if (blocked) return { response: blocked };
  const auth = await authenticateMerchantApp(req);
  if (!auth) return { response: unauthenticatedMerchantApp() };
  return { auth };
}

export async function GET(req: NextRequest) {
  const result = await readPayload(req);
  if ("response" in result) return result.response;
  const menu = await getPartnerMenu(result.auth.restaurantId);
  if (!menu) return Response.json({ ok: false, error: "Merchant not found" }, { status: 404 });
  return Response.json({
    items: menu.items.map((item) => mapItem(item, result.auth.businessId)),
    modifierGroups: menu.modifierGroups,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const blocked = guardBudget(req, "merchantServiceWrite");
  if (blocked) return blocked;
  const auth = await authenticateMerchantApp(req);
  if (!auth) return unauthenticatedMerchantApp();
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  if (!parsed.body || typeof parsed.body !== "object" || Array.isArray(parsed.body)) return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
  const body = parsed.body as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 500) : "";
  const category = typeof body.category === "string" && body.category.trim() ? body.category.trim().slice(0, 80) : "Other";
  const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl.trim().slice(0, 1000) : "";
  const priceCents = Number(body.price);
  const dietary = typeof body.dietary === "string" ? body.dietary : "unspecified";
  if (!name || !Number.isSafeInteger(priceCents) || priceCents < 100 || priceCents > 10_000_000 || !["veg", "nonveg", "unspecified"].includes(dietary)) {
    return Response.json({ ok: false, error: "Enter a valid item name, price and dietary type." }, { status: 400 });
  }
  if (imageUrl) {
    try { if (new URL(imageUrl).protocol !== "https:") throw new Error(); }
    catch { return Response.json({ ok: false, error: "Image must be a valid HTTPS URL." }, { status: 400 }); }
  }
  const created = await createMenuItem(auth.restaurantId, {
    name, description, category, priceCents, imageUrl, isVeg: dietary === "veg", isBestseller: false,
    available: true, stockQuantity: body.stockQuantity,
  });
  if (!created.ok) return Response.json({ ok: false, error: created.error }, { status: 400 });
  let item = created.item;
  if (Array.isArray(body.modifierGroupIds)) {
    const linked = await setItemModifierGroups(auth.restaurantId, item.id, body.modifierGroupIds);
    if (!linked.ok) return Response.json({ ok: false, error: linked.error }, { status: 400 });
    item = linked.item;
  }
  return Response.json({ item: mapItem(item, auth.businessId) }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const blocked = guardBudget(req, "merchantServiceWrite");
  if (blocked) return blocked;
  const auth = await authenticateMerchantApp(req);
  if (!auth) return unauthenticatedMerchantApp();
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  if (!parsed.body || typeof parsed.body !== "object" || Array.isArray(parsed.body)) return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
  const body = parsed.body as Record<string, unknown>;
  const idText = typeof body.id === "string" ? body.id : String(body.id ?? "");
  if (!ID.test(idText)) return Response.json({ ok: false, error: "Invalid item id." }, { status: 400 });
  const id = Number(idText);
  const menu = await getPartnerMenu(auth.restaurantId);
  const current = menu?.items.find((item) => item.id === id);
  if (!current) return Response.json({ ok: false, error: "Item not found." }, { status: 404 });
  if (current.posSynced) return Response.json({ ok: false, error: "This item is managed by the connected POS. Edit it in its source system." }, { status: 409 });
  if (body.action === "modifier-groups") {
    const linked = await setItemModifierGroups(auth.restaurantId, id, body.modifierGroupIds);
    if (!linked.ok) return Response.json({ ok: false, error: linked.error }, { status: linked.error === "Dish not found" ? 404 : 400 });
    return Response.json({ item: mapItem(linked.item, auth.businessId) });
  }
  let changes: Record<string, unknown>;
  if (body.action === "availability") {
    if (typeof body.available !== "boolean") return Response.json({ ok: false, error: "Invalid availability." }, { status: 400 });
    changes = { available: body.available };
  } else {
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    const priceCents = Number(body.price);
    const dietary = typeof body.dietary === "string" ? body.dietary : "unspecified";
    const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl.trim().slice(0, 1000) : "";
    if (!name || !Number.isSafeInteger(priceCents) || priceCents < 100 || priceCents > 10_000_000 || !["veg", "nonveg", "unspecified"].includes(dietary)) {
      return Response.json({ ok: false, error: "Enter a valid item name, price and dietary type." }, { status: 400 });
    }
    if (imageUrl) { try { if (new URL(imageUrl).protocol !== "https:") throw new Error(); } catch { return Response.json({ ok: false, error: "Image must be a valid HTTPS URL." }, { status: 400 }); } }
    changes = {
      name,
      description: typeof body.description === "string" ? body.description.trim().slice(0, 500) : "",
      category: typeof body.category === "string" && body.category.trim() ? body.category.trim().slice(0, 80) : "Other",
      imageUrl, priceCents, isVeg: dietary === "veg", isBestseller: false,
      stockQuantity: body.stockQuantity,
    };
  }
  const updated = await updateMenuItem(auth.restaurantId, id, changes);
  if (!updated.ok) return Response.json({ ok: false, error: updated.error }, { status: updated.error === "Menu item not found" ? 404 : 400 });
  let item = updated.item;
  if (Array.isArray(body.modifierGroupIds)) {
    const linked = await setItemModifierGroups(auth.restaurantId, id, body.modifierGroupIds);
    if (!linked.ok) return Response.json({ ok: false, error: linked.error }, { status: 400 });
    item = linked.item;
  }
  return Response.json({ item: mapItem(item, auth.businessId) });
}

export async function DELETE(req: NextRequest) {
  const blocked = guardBudget(req, "merchantServiceWrite");
  if (blocked) return blocked;
  const auth = await authenticateMerchantApp(req);
  if (!auth) return unauthenticatedMerchantApp();
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  if (!parsed.body || typeof parsed.body !== "object" || Array.isArray(parsed.body)) return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
  const body = parsed.body as Record<string, unknown>;
  const idText = typeof body.id === "string" ? body.id : String(body.id ?? "");
  if (!ID.test(idText)) return Response.json({ ok: false, error: "Invalid item id." }, { status: 400 });
  const menu = await getPartnerMenu(auth.restaurantId);
  const current = menu?.items.find((item) => item.id === Number(idText));
  if (!current) return Response.json({ ok: false, error: "Item not found." }, { status: 404 });
  if (current.posSynced) return Response.json({ ok: false, error: "This item is managed by the connected POS. Archive it in its source system." }, { status: 409 });
  const deleted = await deleteMenuItem(auth.restaurantId, Number(idText));
  if (!deleted.ok) return Response.json({ ok: false, error: deleted.error ?? "Could not archive item" }, { status: 400 });
  return Response.json({ ok: true });
}
