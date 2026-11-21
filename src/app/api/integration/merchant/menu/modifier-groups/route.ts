import { NextRequest } from "next/server";
import {
  createModifierGroup,
  deleteModifierGroup,
  getPartnerMenu,
  updateModifierGroup,
} from "@/db/partner-menu";
import { guardBudget, readJsonBody } from "@/lib/abuse";
import { authenticateMerchantApp, unauthenticatedMerchantApp } from "@/lib/merchant-app-auth";

export const dynamic = "force-dynamic";
const ID = /^\d{1,12}$/;

async function auth(req: NextRequest, write: boolean) {
  const blocked = guardBudget(req, write ? "merchantServiceWrite" : "merchantServiceRead");
  if (blocked) return { response: blocked };
  const merchant = await authenticateMerchantApp(req);
  if (!merchant) return { response: unauthenticatedMerchantApp() };
  return { merchant };
}

async function jsonBody(req: NextRequest) {
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return { response: parsed.response };
  if (!parsed.body || typeof parsed.body !== "object" || Array.isArray(parsed.body)) {
    return { response: Response.json({ ok: false, error: "Invalid request" }, { status: 400 }) };
  }
  return { body: parsed.body as Record<string, unknown> };
}

function groupId(value: unknown): number | null {
  const text = typeof value === "string" ? value : String(value ?? "");
  return ID.test(text) ? Number(text) : null;
}

async function ownedNonPosGroup(restaurantId: number, id: number) {
  const menu = await getPartnerMenu(restaurantId);
  return menu?.modifierGroups.find((group) => group.id === id) ?? null;
}

/** Modifier groups (including one-of variants) for the paired Merchant App. */
export async function GET(req: NextRequest) {
  const result = await auth(req, false);
  if ("response" in result) return result.response;
  const menu = await getPartnerMenu(result.merchant.restaurantId);
  if (!menu) return Response.json({ ok: false, error: "Merchant not found" }, { status: 404 });
  return Response.json({ modifierGroups: menu.modifierGroups }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const result = await auth(req, true);
  if ("response" in result) return result.response;
  const body = await jsonBody(req);
  if ("response" in body) return body.response;
  const created = await createModifierGroup(result.merchant.restaurantId, body.body);
  if (!created.ok) return Response.json({ ok: false, error: created.error }, { status: 400 });
  return Response.json({ group: created.group }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const result = await auth(req, true);
  if ("response" in result) return result.response;
  const body = await jsonBody(req);
  if ("response" in body) return body.response;
  const id = groupId(body.body.id);
  if (id === null) return Response.json({ ok: false, error: "Invalid modifier group id." }, { status: 400 });
  const current = await ownedNonPosGroup(result.merchant.restaurantId, id);
  if (!current) return Response.json({ ok: false, error: "Modifier group not found." }, { status: 404 });
  if (current.posSynced) return Response.json({ ok: false, error: "This group is managed by the connected POS. Edit it in its source system." }, { status: 409 });
  const updated = await updateModifierGroup(result.merchant.restaurantId, id, body.body);
  if (!updated.ok) return Response.json({ ok: false, error: updated.error }, { status: 400 });
  return Response.json({ group: updated.group });
}

export async function DELETE(req: NextRequest) {
  const result = await auth(req, true);
  if ("response" in result) return result.response;
  const body = await jsonBody(req);
  if ("response" in body) return body.response;
  const id = groupId(body.body.id);
  if (id === null) return Response.json({ ok: false, error: "Invalid modifier group id." }, { status: 400 });
  const current = await ownedNonPosGroup(result.merchant.restaurantId, id);
  if (!current) return Response.json({ ok: false, error: "Modifier group not found." }, { status: 404 });
  if (current.posSynced) return Response.json({ ok: false, error: "This group is managed by the connected POS. Remove it in its source system." }, { status: 409 });
  const deleted = await deleteModifierGroup(result.merchant.restaurantId, id);
  if (!deleted.ok) return Response.json({ ok: false, error: deleted.error }, { status: 400 });
  return Response.json({ ok: true });
}
