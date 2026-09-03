import { db } from "@/db";
import { marketplaceProfiles, restaurants } from "@/db/schema";
import { getAllListings } from "@/lib/data";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const STATUSES = ["draft", "pending_review", "live", "suspended"];

export async function GET() {
  try {
    return Response.json({ listings: await getAllListings() });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Failed to load listings" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const slug = String(body.slug ?? "").trim();
    if (!slug) {
      return Response.json({ error: "slug is required" }, { status: 400 });
    }

    const [restaurant] = await db
      .select({ id: restaurants.id })
      .from(restaurants)
      .where(eq(restaurants.slug, slug))
      .limit(1);

    if (!restaurant) {
      return Response.json({ error: "Restaurant not found" }, { status: 404 });
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };

    for (const key of [
      "isListed",
      "isFeatured",
      "acceptOnlineOrders",
      "acceptDelivery",
      "acceptPickup",
    ] as const) {
      if (typeof body[key] === "boolean") patch[key] = body[key];
    }

    if (typeof body.marketplaceStatus === "string") {
      if (!STATUSES.includes(body.marketplaceStatus)) {
        return Response.json(
          { error: `marketplaceStatus must be one of ${STATUSES.join(", ")}` },
          { status: 400 },
        );
      }
      patch.marketplaceStatus = body.marketplaceStatus;
    }

    for (const key of ["deliveryFee", "minOrder", "commissionRate"] as const) {
      if (body[key] !== undefined && Number.isFinite(Number(body[key]))) {
        patch[key] = Number(body[key]).toFixed(2);
      }
    }
    for (const key of ["etaMinutes", "pickupEtaMinutes"] as const) {
      if (body[key] !== undefined && Number.isFinite(Number(body[key]))) {
        patch[key] = Math.max(1, Math.round(Number(body[key])));
      }
    }
    for (const key of ["logoUrl", "tagline"] as const) {
      if (typeof body[key] === "string") patch[key] = body[key];
    }
    // null clears the override so the POS value is inherited again
    for (const key of ["descriptionOverride", "coverImageOverride"] as const) {
      if (body[key] === null || typeof body[key] === "string") {
        patch[key] = body[key] === "" ? null : body[key];
      }
    }

    if (patch.isListed === true && !patch.marketplaceStatus) {
      patch.listedAt = new Date();
    }

    const [updated] = await db
      .update(marketplaceProfiles)
      .set(patch)
      .where(eq(marketplaceProfiles.restaurantId, restaurant.id))
      .returning();

    return Response.json({ profile: updated });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Failed to update listing" }, { status: 500 });
  }
}
