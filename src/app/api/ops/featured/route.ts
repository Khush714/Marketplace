import { NextRequest } from "next/server";
import { recordIntegrationAudit, setFeaturedAsOps } from "@/db/queries";
import { requireOpsToken } from "@/lib/ops-auth";
import { apiError, badRequest } from "@/lib/security/errors";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/ops/featured   { restaurant_id, featured }
 *
 * Ops-only merchandising toggle for the home page "Featured tonight" rail.
 *
 * `featured` was previously writable only by the seed script, which made the
 * most valuable slot on the home page impossible to curate after the fact, and
 * left every newly onboarded restaurant unpromotable — `featured` is also the
 * primary key of the default browse sort, so an unpromotable listing is
 * permanently last.
 *
 * Ops-gated rather than exposed on the partner surface: featuring is a platform
 * decision, and a partner that could grant it to itself would have no reason
 * not to. Kept separate from /api/ops/owner-key so that route stays a single
 * concern (issuing the owner-key capability).
 */
export async function PATCH(req: NextRequest) {
  const rejected = requireOpsToken(req);
  if (rejected) return rejected;

  let body: { restaurant_id?: unknown; featured?: unknown };
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid request.");
  }

  const restaurantId = Number(body?.restaurant_id);
  if (!Number.isInteger(restaurantId) || restaurantId <= 0) {
    return badRequest("restaurant_id is required");
  }
  if (typeof body?.featured !== "boolean") {
    return badRequest("featured must be a boolean");
  }

  const result = await setFeaturedAsOps(restaurantId, body.featured);
  if (!result.ok) {
    const status = result.code === "NOT_FOUND" ? 404 : 400;
    return apiError(status, result.error, result.code);
  }

  await recordIntegrationAudit(result.restaurant.id, "listing.featured_changed", {
    actor: "ops",
    ipAddress: req.headers.get("x-forwarded-for") ?? null,
  }, { featured: result.restaurant.featured });

  return Response.json({ ok: true, ...result.restaurant });
}
