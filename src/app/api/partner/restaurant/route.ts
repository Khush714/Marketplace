import { NextRequest } from "next/server";
import {
  deleteRestaurant,
  getRestaurantByOwnerKey,
  setRestaurantActive,
  updateRestaurantProfile,
} from "@/db/queries";

export const dynamic = "force-dynamic";

/** Look up the listing controlled by an owner key. */
export async function GET(req: NextRequest) {
  // Phase 7 — ownerKey rides a header, never a URL query (query params leak
  // into logs/proxies and land in browser history).
  const ownerKey = String(req.headers.get("x-owner-key") ?? "").trim();
  const restaurant = await getRestaurantByOwnerKey(ownerKey);
  if (!restaurant) return Response.json({ ok: false, error: "Invalid owner key" }, { status: 404 });
  return Response.json({ ok: true, restaurant });
}

/**
 * Two owner-scoped listing mutations, distinguished by the body:
 *   { ownerKey, active }                    -> pause / resume
 *   { ownerKey, profile: {...} }            -> edit name, tagline, cuisines,
 *                                              locality, imagery, pure-veg
 *
 * The restaurant is resolved from the owner key in both cases — `restaurant_id`
 * is never read from the request, so a key cannot edit a listing it does not
 * own. The profile edit exists because onboarding is otherwise write-once: with
 * only pause/resume available, a mistyped name or an off-list cuisine tag could
 * only be fixed by deleting the listing and redeeming a new code.
 */
export async function PATCH(req: NextRequest) {
  let body: {
    ownerKey?: unknown;
    active?: unknown;
    profile?: {
      name?: unknown;
      tagline?: unknown;
      cuisines?: unknown;
      locality?: unknown;
      imageUrl?: unknown;
      heroUrl?: unknown;
      pureVeg?: unknown;
    };
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }

  const ownerKey = String(body?.ownerKey ?? "").trim();
  if (!ownerKey) {
    return Response.json({ ok: false, error: "Owner key is required" }, { status: 400 });
  }

  if (body?.profile && typeof body.profile === "object") {
    const p = body.profile;
    const result = await updateRestaurantProfile(ownerKey, {
      name: String(p.name ?? ""),
      tagline: String(p.tagline ?? ""),
      cuisines: p.cuisines as string[],
      locality: String(p.locality ?? ""),
      imageUrl: p.imageUrl == null ? undefined : String(p.imageUrl),
      heroUrl: p.heroUrl == null ? undefined : String(p.heroUrl),
      pureVeg: Boolean(p.pureVeg),
    });
    // 404 mirrors the rest of the partner surface: an unauthenticated caller
    // must not be able to probe which owner keys exist.
    if (!result.ok) {
      const status = result.error === "Invalid owner key" ? 404 : 400;
      return Response.json(result, { status });
    }
    return Response.json(result);
  }

  const result = await setRestaurantActive(ownerKey, Boolean(body?.active));
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