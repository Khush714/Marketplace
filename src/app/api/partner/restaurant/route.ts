import { NextRequest } from "next/server";
import { deleteRestaurant, getRestaurantByOwnerKey, setRestaurantActive } from "@/db/queries";

export const dynamic = "force-dynamic";

/** Look up the listing controlled by an owner key. */
export async function GET(req: NextRequest) {
  const ownerKey = String(req.nextUrl.searchParams.get("ownerKey") ?? "").trim();
  const restaurant = await getRestaurantByOwnerKey(ownerKey);
  if (!restaurant) return Response.json({ ok: false, error: "Invalid owner key" }, { status: 404 });
  return Response.json({ ok: true, restaurant });
}

/** Pause or resume an owner's listing. */
export async function PATCH(req: NextRequest) {
  let ownerKey: string;
  let active: boolean;
  try {
    const body = await req.json();
    ownerKey = String(body?.ownerKey ?? "").trim();
    active = Boolean(body?.active);
  } catch {
    return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }
  const result = await setRestaurantActive(ownerKey, active);
  if (!result.ok) return Response.json(result, { status: 404 });
  return Response.json(result);
}

/** Permanently delete an owner's listing (typed restaurant name required). */
export async function DELETE(req: NextRequest) {
  let ownerKey: string;
  let confirmName: string;
  try {
    const body = await req.json();
    ownerKey = String(body?.ownerKey ?? "").trim();
    confirmName = String(body?.confirmName ?? "");
  } catch {
    return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }
  const result = await deleteRestaurant(ownerKey, confirmName);
  if (!result.ok) return Response.json(result, { status: 400 });
  return Response.json(result);
}