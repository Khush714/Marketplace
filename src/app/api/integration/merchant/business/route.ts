import { NextRequest } from "next/server";
import { updateMerchantRestaurant } from "@/db/merchant-integration";
import { guardRead, guardWrite, readJsonBody } from "@/lib/abuse";
import { requireMerchantIntegration } from "../_auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function merchantRestaurant(restaurant: NonNullable<Awaited<ReturnType<typeof updateMerchantRestaurant>>>) {
  return {
    id: restaurant.id,
    slug: restaurant.slug,
    name: restaurant.name,
    isActive: restaurant.isActive,
    merchantPickupEnabled: restaurant.merchantPickupEnabled,
    merchantDeliveryEnabled: restaurant.merchantDeliveryEnabled,
    merchantHoursEnabled: restaurant.merchantHoursEnabled,
    merchantOpensAt: restaurant.merchantOpensAt,
    merchantClosesAt: restaurant.merchantClosesAt,
  };
}

export async function GET(req: NextRequest) {
  const blocked = guardRead(req, "merchantIntegrationRead");
  if (blocked) return blocked;
  const auth = await requireMerchantIntegration(req);
  if (!auth.ok) return auth.response;

  return Response.json(
    { ok: true, restaurant: auth.session.restaurant },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(req: NextRequest) {
  const blocked = await guardWrite(req, "merchantIntegrationWrite");
  if (blocked) return blocked;
  const auth = await requireMerchantIntegration(req);
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body =
    parsed.body !== null && typeof parsed.body === "object" && !Array.isArray(parsed.body)
      ? (parsed.body as Record<string, unknown>)
      : null;
  if (!body) {
    return Response.json({ ok: false, error: "Invalid business settings." }, { status: 400 });
  }

  const changes: Parameters<typeof updateMerchantRestaurant>[1] = {};
  if ("name" in body) {
    const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
    if (!name || name.length > 100) {
      return Response.json({ ok: false, error: "Business name must be 1–100 characters." }, { status: 400 });
    }
    changes.name = name;
  }
  if ("isActive" in body) {
    if (typeof body.isActive !== "boolean") {
      return Response.json({ ok: false, error: "Invalid business availability." }, { status: 400 });
    }
    changes.isActive = body.isActive;
  }

  const settingsKeys = [
    "merchantPickupEnabled",
    "merchantDeliveryEnabled",
    "merchantHoursEnabled",
    "merchantOpensAt",
    "merchantClosesAt",
  ] as const;
  if (settingsKeys.some((key) => key in body)) {
    if (
      typeof body.merchantPickupEnabled !== "boolean" ||
      typeof body.merchantDeliveryEnabled !== "boolean" ||
      typeof body.merchantHoursEnabled !== "boolean" ||
      typeof body.merchantOpensAt !== "string" ||
      typeof body.merchantClosesAt !== "string" ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.merchantOpensAt) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.merchantClosesAt) ||
      body.merchantOpensAt === body.merchantClosesAt ||
      (!body.merchantPickupEnabled && !body.merchantDeliveryEnabled)
    ) {
      return Response.json({ ok: false, error: "Invalid fulfilment or opening-hour settings." }, { status: 400 });
    }
    changes.merchantPickupEnabled = body.merchantPickupEnabled;
    changes.merchantDeliveryEnabled = body.merchantDeliveryEnabled;
    changes.merchantHoursEnabled = body.merchantHoursEnabled;
    changes.merchantOpensAt = body.merchantOpensAt;
    changes.merchantClosesAt = body.merchantClosesAt;
  }
  if (Object.keys(changes).length === 0) {
    return Response.json({ ok: false, error: "No supported business settings were provided." }, { status: 400 });
  }

  const restaurant = await updateMerchantRestaurant(auth.session.restaurant.id, changes);
  if (!restaurant) {
    return Response.json({ ok: false, error: "Marketplace listing not found." }, { status: 404 });
  }
  return Response.json(
    { ok: true, restaurant: merchantRestaurant(restaurant) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
