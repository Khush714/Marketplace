import { NextRequest } from "next/server";
import { listListingSetup, provisionListingAsOps } from "@/db/queries";
import { recordIntegrationAudit } from "@/db/queries";
import { requireOpsToken } from "@/lib/ops-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET  /api/ops/owner-key
 * POST /api/ops/owner-key   { restaurant_id, external_id? }
 *
 * Ops provisioning for listings that cannot complete the POS handshake.
 *
 * A listing needs BOTH an owner key and an external id before
 * /partner/integrations can connect it. Listings seeded straight into the
 * database have neither, and the normal /partner redemption cannot fix that
 * because it needs an external id to create the listing in the first place.
 *
 * GET reports readiness for every listing so ops can see what is stranded.
 * POST issues a fresh owner key, returned exactly once, and backfills a missing
 * external id. It is ops-gated rather than open because it mints a capability
 * that grants full control of a listing: whoever holds it can edit the menu,
 * pause the listing, and read the integration record.
 *
 * The passkey rotation route cannot serve this purpose, since rotation requires
 * the CURRENT key - by design, there is no self-service recovery path.
 */
export async function GET(req: NextRequest) {
  const rejected = requireOpsToken(req);
  if (rejected) return rejected;
  return Response.json({ ok: true, listings: await listListingSetup() });
}

export async function POST(req: NextRequest) {
  const rejected = requireOpsToken(req);
  if (rejected) return rejected;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "Invalid request", code: "BAD_JSON" }, { status: 400 });
  }

  const result = await provisionListingAsOps({
    restaurantId: Number(body.restaurant_id),
    externalId: body.external_id == null ? null : String(body.external_id),
    rotateOwnerKey: body.rotate_owner_key === true,
  });

  if (!result.ok) {
    // 404 for a missing listing mirrors the rest of the partner surface: an
    // unauthenticated caller must not be able to probe which ids exist.
    const status = result.code === "NOT_FOUND" ? 404 : 400;
    return Response.json(result, { status });
  }

  const ipAddress = req.headers.get("x-forwarded-for") ?? null;
  await recordIntegrationAudit(result.restaurantId, "owner_key.issued_by_ops", {
    actor: "ops",
    ipAddress,
  });

  return Response.json(
    {
      ok: true,
      restaurantId: result.restaurantId,
      externalId: result.externalId,
      ownerKey: result.ownerKey,
      rotated: result.rotated,
      unchanged: result.unchanged === true,
      warning: result.ownerKey
        ? "Shown once. Store it now; it cannot be recovered from the database later."
        : "The existing owner key was left untouched.",
    },
    { status: 200 },
  );
}
