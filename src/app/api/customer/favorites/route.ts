import { NextRequest } from "next/server";

import { guardRead, guardWrite, readJsonBody } from "@/lib/abuse";
import { CUSTOMER_MAX_FAVORITES } from "@/lib/customer-account-core";
import { addCustomerFavorite, listCustomerFavorites, removeCustomerFavorite } from "@/db/customer-accounts";
import { requireAccountSession } from "@/lib/security/customer-account-session";
import { db } from "@/db";
import { restaurants } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

async function resolveRestaurantId(slugOrId: unknown): Promise<number | null> {
  if (typeof slugOrId === "number" && Number.isInteger(slugOrId) && slugOrId > 0) return slugOrId;
  const raw = String(slugOrId ?? "").trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  // Lightweight slug -> id lookup (active restaurants only), avoiding full menu load.
  const [row] = await db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(and(eq(restaurants.slug, raw), eq(restaurants.isActive, true)))
    .limit(1);
  return row?.id ?? null;
}

export async function GET(req: NextRequest) {
  const blocked = await guardRead(req, "customerAccountRead");
  if (blocked) return blocked;
  const auth = await requireAccountSession(req, { mutating: false });
  if (!auth.ok) return auth.response;

  const rows = await listCustomerFavorites(auth.session.account.id);
  if (!rows.length) return Response.json({ ok: true, favorites: [] });

  const ids = rows.map((r) => r.restaurantId);
  const found = await db
    .select({ id: restaurants.id, slug: restaurants.slug, name: restaurants.name })
    .from(restaurants)
    .where(inArray(restaurants.id, ids));
  const byId = new Map(found.map((r) => [r.id, r]));

  const favorites = rows
    .map((r) => {
      const info = byId.get(r.restaurantId);
      if (!info) return null;
      return { restaurantId: info.id, slug: info.slug, name: info.name };
    })
    .filter((x): x is { restaurantId: number; slug: string; name: string } => Boolean(x));

  return Response.json({ ok: true, favorites });
}

export async function POST(req: NextRequest) {
  const blocked = await guardWrite(req, "customerAccountWrite");
  if (blocked) return blocked;
  const auth = await requireAccountSession(req, { mutating: true });
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = (parsed.body ?? {}) as { slug?: unknown; restaurantId?: unknown };

  const existing = await listCustomerFavorites(auth.session.account.id);
  if (existing.length >= CUSTOMER_MAX_FAVORITES) {
    return Response.json({ ok: false, error: "Favorites limit reached" }, { status: 400 });
  }

  const restaurantId = await resolveRestaurantId(body.slug ?? body.restaurantId);
  if (!restaurantId) return Response.json({ ok: false, error: "Restaurant not found" }, { status: 404 });

  const row = await addCustomerFavorite(auth.session.account.id, restaurantId);
  if (!row) return Response.json({ ok: false, error: "Unable to save favorite" }, { status: 400 });

  return Response.json({ ok: true, favorite: { restaurantId } }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const blocked = await guardWrite(req, "customerAccountWrite");
  if (blocked) return blocked;
  const auth = await requireAccountSession(req, { mutating: true });
  if (!auth.ok) return auth.response;

  // Accept slug/restaurantId via query or JSON body for flexibility.
  const url = new URL(req.url);
  let slugOrId: unknown = url.searchParams.get("slug") ?? url.searchParams.get("restaurantId");
  if (slugOrId == null) {
    const parsed = await readJsonBody(req);
    if (parsed.ok) {
      const body = (parsed.body ?? {}) as { slug?: unknown; restaurantId?: unknown };
      slugOrId = body.slug ?? body.restaurantId;
    }
  }

  const restaurantId = await resolveRestaurantId(slugOrId);
  if (!restaurantId) return Response.json({ ok: false, error: "Restaurant not found" }, { status: 404 });

  const removed = await removeCustomerFavorite(auth.session.account.id, restaurantId);
  if (!removed) return Response.json({ ok: false, error: "Favorite not found" }, { status: 404 });

  return Response.json({ ok: true });
}
