import { NextRequest } from "next/server";
import {
  createMerchantMenuItem,
  deleteMerchantMenuItem,
  listMerchantMenuItems,
  updateMerchantMenuItem,
  type MerchantMenuItemInput,
} from "@/db/merchant-integration";
import { guardRead, guardWrite, readJsonBody } from "@/lib/abuse";
import { requireMerchantIntegration } from "../../_auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function itemInput(body: Record<string, unknown>): MerchantMenuItemInput | null {
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  const description =
    typeof body.description === "string" ? body.description.trim().slice(0, 500) : "";
  const category =
    typeof body.category === "string" ? body.category.trim().replace(/\s+/g, " ") : "Other";
  const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
  const price = body.price;
  const dietary = body.dietary;
  if (
    !name ||
    name.length > 120 ||
    category.length > 80 ||
    typeof price !== "number" ||
    !Number.isSafeInteger(price) ||
    price < 100 ||
    price > 10_000_000 ||
    (dietary !== "veg" && dietary !== "nonveg" && dietary !== "unspecified")
  ) {
    return null;
  }
  return {
    name,
    description,
    category: category || "Other",
    price,
    imageUrl,
    dietary,
  };
}

function itemId(body: Record<string, unknown>): number | null {
  const raw = body.id;
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const text = String(raw);
  if (!/^[1-9]\d*$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) ? id : null;
}

export async function GET(req: NextRequest) {
  const blocked = guardRead(req, "merchantIntegrationRead");
  if (blocked) return blocked;
  const auth = await requireMerchantIntegration(req);
  if (!auth.ok) return auth.response;

  const items = await listMerchantMenuItems(
    auth.session.restaurant.id,
    auth.session.merchantBusinessId,
  );
  return Response.json({ ok: true, items }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const blocked = await guardWrite(req, "merchantIntegrationWrite");
  if (blocked) return blocked;
  const auth = await requireMerchantIntegration(req);
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = record(parsed.body);
  const input = body ? itemInput(body) : null;
  if (!input) {
    return Response.json({ ok: false, error: "Enter a valid menu item and price in paise." }, { status: 400 });
  }

  const item = await createMerchantMenuItem(
    auth.session.restaurant.id,
    auth.session.merchantBusinessId,
    input,
  );
  if (!item) return Response.json({ ok: false, error: "Could not create menu item." }, { status: 500 });
  return Response.json({ ok: true, item }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: NextRequest) {
  const blocked = await guardWrite(req, "merchantIntegrationWrite");
  if (blocked) return blocked;
  const auth = await requireMerchantIntegration(req);
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = record(parsed.body);
  const id = body ? itemId(body) : null;
  if (!body || id === null) {
    return Response.json({ ok: false, error: "Invalid menu item." }, { status: 400 });
  }

  let changes: Partial<MerchantMenuItemInput> | { available: boolean };
  if (body.action === "availability") {
    if (typeof body.available !== "boolean") {
      return Response.json({ ok: false, error: "Invalid item availability." }, { status: 400 });
    }
    changes = { available: body.available };
  } else {
    const input = itemInput(body);
    if (!input) {
      return Response.json({ ok: false, error: "Enter a valid menu item and price in paise." }, { status: 400 });
    }
    changes = input;
  }

  const item = await updateMerchantMenuItem(
    auth.session.restaurant.id,
    auth.session.merchantBusinessId,
    id,
    changes,
  );
  if (!item) return Response.json({ ok: false, error: "Menu item not found." }, { status: 404 });
  return Response.json({ ok: true, item }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(req: NextRequest) {
  const blocked = await guardWrite(req, "merchantIntegrationWrite");
  if (blocked) return blocked;
  const auth = await requireMerchantIntegration(req);
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = record(parsed.body);
  const id = body ? itemId(body) : null;
  if (id === null) {
    return Response.json({ ok: false, error: "Invalid menu item." }, { status: 400 });
  }
  const deleted = await deleteMerchantMenuItem(auth.session.restaurant.id, id);
  if (!deleted) return Response.json({ ok: false, error: "Menu item not found." }, { status: 404 });
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
