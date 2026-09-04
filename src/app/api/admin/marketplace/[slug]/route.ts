import { db } from "@/db";
import { restaurants, marketplaceProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { marketplaceStats } from "@/lib/admin";
import { normalizeMenuUrl } from "@/lib/menu-url";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

const PRICE_RANGES = ["$", "$$", "$$$", "$$$$"];

/**
 * GET /api/admin/marketplace/:slug
 * The restaurant's own onboarding state: POS-owned fields the owner edits
 * (description, cuisine, price range, image) plus their marketplace profile.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { slug } = await params;
  const [row] = await db
    .select({ restaurant: restaurants, profile: marketplaceProfiles })
    .from(restaurants)
    .innerJoin(
      marketplaceProfiles,
      eq(marketplaceProfiles.restaurantId, restaurants.id),
    )
    .where(eq(restaurants.slug, slug))
    .limit(1);

  if (!row) return Response.json({ error: "Restaurant not found" }, { status: 404 });

  const { restaurant: r, profile: p } = row;
  const stats = await marketplaceStats(r.id);
  return Response.json({
    restaurant: {
      slug: r.slug,
      name: r.name,
      description: r.description,
      cuisine: r.cuisine,
      priceRange: r.priceRange,
      imageUrl: r.imageUrl,
      address: r.address,
    },
    marketplace: {
      isListed: p.isListed,
      marketplaceStatus: p.marketplaceStatus,
      acceptOnlineOrders: p.acceptOnlineOrders,
      acceptDelivery: p.acceptDelivery,
      acceptPickup: p.acceptPickup,
      deliveryFee: p.deliveryFee,
      minOrder: p.minOrder,
      etaMinutes: p.etaMinutes,
      pickupEtaMinutes: p.pickupEtaMinutes,
      tagline: p.tagline,
      logoUrl: p.logoUrl,
      menuUrl: p.menuUrl,
    },
    stats,
  });
}

/**
 * PUT /api/admin/marketplace/:slug  —  the SAVE button.
 * POS-owned fields are written to `restaurants`; marketplace behaviour is
 * written to the profile. Enabling "List my restaurant" makes the restaurant
 * immediately eligible for the consumer platform.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  try {
    if (!(await requireAdmin())) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json();

    const [restaurant] = await db
      .select({ id: restaurants.id })
      .from(restaurants)
      .where(eq(restaurants.slug, slug))
      .limit(1);
    if (!restaurant) {
      return Response.json({ error: "Restaurant not found" }, { status: 404 });
    }

    // ---- POS-owned fields (the owner edits their own record) --------------
    const restaurantPatch: Record<string, unknown> = {};
    if (typeof body.description === "string") {
      restaurantPatch.description = body.description.trim().slice(0, 2000);
    }
    if (typeof body.cuisine === "string" && body.cuisine.trim()) {
      restaurantPatch.cuisine = body.cuisine.trim().slice(0, 80);
    }
    if (typeof body.priceRange === "string") {
      if (!PRICE_RANGES.includes(body.priceRange)) {
        return Response.json(
          { error: `priceRange must be one of ${PRICE_RANGES.join(", ")}` },
          { status: 400 },
        );
      }
      restaurantPatch.priceRange = body.priceRange;
    }
    if (typeof body.imageUrl === "string" && body.imageUrl.trim()) {
      restaurantPatch.imageUrl = body.imageUrl.trim();
    }

    // ---- Marketplace profile ---------------------------------------------
    const profilePatch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of [
      "acceptOnlineOrders",
      "acceptDelivery",
      "acceptPickup",
      "isListed",
    ] as const) {
      if (typeof body[key] === "boolean") profilePatch[key] = body[key];
    }
    if (typeof body.tagline === "string") {
      profilePatch.tagline = body.tagline.trim().slice(0, 200);
    }
    if (typeof body.menuUrl === "string") {
      try {
        profilePatch.menuUrl = normalizeMenuUrl(body.menuUrl);
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : "Invalid menu URL" },
          { status: 400 },
        );
      }
    }
    for (const key of ["deliveryFee", "minOrder"] as const) {
      if (body[key] !== undefined && Number.isFinite(Number(body[key]))) {
        profilePatch[key] = Math.max(0, Number(body[key])).toFixed(2);
      }
    }
    for (const key of ["etaMinutes", "pickupEtaMinutes"] as const) {
      if (body[key] !== undefined && Number.isFinite(Number(body[key]))) {
        profilePatch[key] = Math.max(1, Math.round(Number(body[key])));
      }
    }

    // Read the current profile so validation runs against the EFFECTIVE state
    // after this save, not just the fields the request happened to include.
    const [current] = await db
      .select()
      .from(marketplaceProfiles)
      .where(eq(marketplaceProfiles.restaurantId, restaurant.id))
      .limit(1);
    if (!current) {
      return Response.json({ error: "Profile not found" }, { status: 404 });
    }

    const effective = {
      isListed: (profilePatch.isListed as boolean | undefined) ?? current.isListed,
      acceptOnlineOrders:
        (profilePatch.acceptOnlineOrders as boolean | undefined) ??
        current.acceptOnlineOrders,
      acceptDelivery:
        (profilePatch.acceptDelivery as boolean | undefined) ??
        current.acceptDelivery,
      acceptPickup:
        (profilePatch.acceptPickup as boolean | undefined) ?? current.acceptPickup,
    };

    // A restaurant accepting online orders needs at least one fulfilment mode.
    if (
      effective.acceptOnlineOrders &&
      !effective.acceptDelivery &&
      !effective.acceptPickup
    ) {
      return Response.json(
        {
          error:
            "Enable at least one fulfilment method (pickup or delivery) before accepting online orders.",
        },
        { status: 400 },
      );
    }

    // Listing toggle drives eligibility for the consumer platform.
    if (profilePatch.isListed === true) {
      profilePatch.marketplaceStatus = "live";
      profilePatch.listedAt = new Date();
    } else if (profilePatch.isListed === false) {
      profilePatch.marketplaceStatus = "draft";
    }

    await db.transaction(async (tx) => {
      if (Object.keys(restaurantPatch).length > 0) {
        await tx
          .update(restaurants)
          .set(restaurantPatch)
          .where(eq(restaurants.id, restaurant.id));
      }
      await tx
        .update(marketplaceProfiles)
        .set(profilePatch)
        .where(eq(marketplaceProfiles.restaurantId, restaurant.id));
    });

    return Response.json({
      saved: true,
      isListed: effective.isListed ?? current.isListed,
      marketplaceStatus:
        (profilePatch.marketplaceStatus as string | undefined) ??
        current.marketplaceStatus,
      consumerEligible:
        (effective.isListed ?? current.isListed) &&
        ((profilePatch.marketplaceStatus as string | undefined) ??
          current.marketplaceStatus) === "live",
    });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Failed to save" }, { status: 500 });
  }
}
