import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { restaurants } from "@/db/schema";
import { getRestaurantManageById, setRestaurantActiveById } from "@/db/queries";
import { guardBudget, readJsonBody } from "@/lib/abuse";
import { authenticateMerchantApp, unauthenticatedMerchantApp } from "@/lib/merchant-app-auth";
import { cleanClosureReason, parseClosureUntil, parseScheduledLeaves } from "@/lib/restaurant-closure";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const blocked = guardBudget(req, "merchantServiceRead");
  if (blocked) return blocked;
  const auth = await authenticateMerchantApp(req);
  if (!auth) return unauthenticatedMerchantApp();
  const restaurant = await getRestaurantManageById(auth.restaurantId);
  if (!restaurant) return Response.json({ ok: false, error: "Marketplace listing not found" }, { status: 404 });
  return Response.json({ ok: true, restaurant }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: NextRequest) {
  const blocked = await guardWriteSafe(req);
  if (blocked) return blocked;
  const auth = await authenticateMerchantApp(req);
  if (!auth) return unauthenticatedMerchantApp();
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  if (!parsed.body || typeof parsed.body !== "object" || Array.isArray(parsed.body)) {
    return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }
  const body = parsed.body as Record<string, unknown>;
  if (typeof body.isActive === "boolean") {
    if (body.isActive) {
      const result = await setRestaurantActiveById(auth.restaurantId, true);
      if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: 404 });
    } else {
      const result = await setRestaurantActiveById(auth.restaurantId, false);
      if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: 404 });
    }
  }
  const changes: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 120) return Response.json({ ok: false, error: "Business name must be 1–120 characters." }, { status: 400 });
    changes.name = name;
  }
  if (body.merchantHoursEnabled !== undefined) {
    if (typeof body.merchantHoursEnabled !== "boolean") return Response.json({ ok: false, error: "Invalid hours setting." }, { status: 400 });
    changes.merchantHoursEnabled = body.merchantHoursEnabled;
  }
  for (const field of ["merchantPickupEnabled", "merchantDeliveryEnabled"] as const) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== "boolean") return Response.json({ ok: false, error: "Invalid fulfilment setting." }, { status: 400 });
      changes[field] = body[field];
    }
  }
  for (const field of ["merchantOpensAt", "merchantClosesAt"] as const) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body[field] as string)) {
        return Response.json({ ok: false, error: "Enter a valid opening and closing time." }, { status: 400 });
      }
      changes[field] = body[field];
    }
  }
  if (body.closureReason !== undefined) {
    try { changes.closureReason = cleanClosureReason(body.closureReason); }
    catch (error) { return closureError(error); }
  }
  if (body.closureUntil !== undefined) {
    try {
      const until = parseClosureUntil(body.closureUntil);
      changes.closureUntil = until ? new Date(until) : null;
    } catch (error) { return closureError(error); }
  }
  if (body.scheduledLeaves !== undefined) {
    try { changes.scheduledLeaves = parseScheduledLeaves(body.scheduledLeaves); }
    catch (error) { return closureError(error); }
  }
  if (body.merchantPickupEnabled === false && body.merchantDeliveryEnabled === false) {
    return Response.json({ ok: false, error: "At least one fulfilment option must remain enabled." }, { status: 400 });
  }
  if (Object.keys(changes).length) {
    await db.update(restaurants).set(changes).where(eq(restaurants.id, auth.restaurantId));
  }
  const restaurant = await getRestaurantManageById(auth.restaurantId);
  if (!restaurant) return Response.json({ ok: false, error: "Marketplace listing not found" }, { status: 404 });
  return Response.json({ ok: true, restaurant }, { headers: { "Cache-Control": "no-store" } });
}

function closureError(error: unknown): Response {
  return Response.json(
    { ok: false, error: error instanceof Error ? error.message : "Invalid closure details." },
    { status: 400 },
  );
}

async function guardWriteSafe(req: NextRequest): Promise<Response | null> {
  const { guardWrite } = await import("@/lib/abuse");
  return guardWrite(req, "merchantServiceWrite");
}
