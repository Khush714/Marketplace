import { db } from "@/db";
import { restaurants, marketplaceProfiles, restaurantIntegrations } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { normalizeMenuUrl } from "@/lib/menu-url";
import { requireAdmin } from "@/lib/admin-auth";
import { restaurantId } from "@/lib/format";
import { webhookSecret } from "@/lib/integrations";

export const dynamic = "force-dynamic";

const PRICE_RANGES = ["$", "$$", "$$$", "$$$$"];

const REQUIRED: Array<{ key: string; label: string }> = [
  { key: "name", label: "name" },
  { key: "slug", label: "slug" },
  { key: "cuisine", label: "cuisine" },
  { key: "description", label: "description" },
  { key: "priceRange", label: "price range" },
  { key: "imageUrl", label: "image" },
  { key: "address", label: "address" },
];

/**
 * GET /api/admin/marketplace — every restaurant with its marketplace profile,
 * including unlisted and pending-review entries. Used by the operator console.
 */
export async function GET() {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await db
    .select({
      restaurantId: restaurants.id,
      marketplaceId: restaurants.marketplaceId,
      profileId: marketplaceProfiles.id,
      name: restaurants.name,
      slug: restaurants.slug,
      cuisine: restaurants.cuisine,
      description: restaurants.description,
      imageUrl: restaurants.imageUrl,
      address: restaurants.address,
      phone: restaurants.phone,
      openingHours: restaurants.openingHours,
      priceRange: restaurants.priceRange,
      isListed: marketplaceProfiles.isListed,
      marketplaceStatus: marketplaceProfiles.marketplaceStatus,
      acceptOnlineOrders: marketplaceProfiles.acceptOnlineOrders,
      acceptDelivery: marketplaceProfiles.acceptDelivery,
      acceptPickup: marketplaceProfiles.acceptPickup,
      menuUrl: marketplaceProfiles.menuUrl,
      createdAt: restaurants.createdAt,
    })
    .from(restaurants)
    .innerJoin(
      marketplaceProfiles,
      eq(marketplaceProfiles.restaurantId, restaurants.id),
    )
    .orderBy(asc(restaurants.name));

  return Response.json({ restaurants: rows });
}

/**
 * POST /api/admin/marketplace — PUBLIC self-enrollment.
 *
 * Creates the POS `restaurants` row and the matching marketplace profile in a
 * single transaction. Self-enrolled restaurants are submitted for admin
 * approval: `is_listed = false`, `marketplace_status = 'pending_review'`, so
 * they stay HIDDEN from the storefront until an operator approves them.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();

    // ---- Required-field validation -------------------------------------
    const missing = REQUIRED.filter((f) => {
      const v = body[f.key];
      return typeof v !== "string" || !v.trim();
    });
    if (missing.length > 0) {
      return Response.json(
        {
          error: `Missing required field(s): ${missing.map((m) => m.label).join(", ")}`,
        },
        { status: 400 },
      );
    }

    const name = body.name.trim().slice(0, 160);
    const slug = body.slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 180);
    const cuisine = body.cuisine.trim().slice(0, 80);
    const description = body.description.trim().slice(0, 2000);
    const address = body.address.trim().slice(0, 240);
    const priceRange = body.priceRange.trim();
    // PHASE 32 — optional identity fields (phone + opening-hours JSON).
    const phone = typeof body.phone === "string" ? body.phone.trim().slice(0, 40) : "";
    const openingHours =
      typeof body.openingHours === "string" && body.openingHours.trim()
        ? body.openingHours.trim().slice(0, 2000)
        : "{}";

    if (!slug) {
      return Response.json({ error: "A valid slug is required (a-z, 0-9, dashes)" }, { status: 400 });
    }
    if (!PRICE_RANGES.includes(priceRange)) {
      return Response.json(
        { error: `priceRange must be one of ${PRICE_RANGES.join(", ")}` },
        { status: 400 },
      );
    }

    // ---- Unique slug ----------------------------------------------------
    const [existing] = await db
      .select({ id: restaurants.id })
      .from(restaurants)
      .where(eq(restaurants.slug, slug))
      .limit(1);
    if (existing) {
      return Response.json(
        { error: "That restaurant slug is already taken. Try another." },
        { status: 409 },
      );
    }

    // ---- online ordering / fulfilment ----------------------------------
    const acceptOnlineOrders = typeof body.acceptOnlineOrders === "boolean" ? body.acceptOnlineOrders : true;
    const acceptDelivery = typeof body.acceptDelivery === "boolean" ? body.acceptDelivery : true;
    const acceptPickup = typeof body.acceptPickup === "boolean" ? body.acceptPickup : true;

    if (acceptOnlineOrders && !acceptDelivery && !acceptPickup) {
      return Response.json(
        {
          error:
            "Enable at least one fulfilment method (pickup or delivery) before accepting online orders.",
        },
        { status: 400 },
      );
    }

    // ---- menu URL (optional) -------------------------------------------
    let menuUrl = "";
    if (typeof body.menuUrl === "string" && body.menuUrl.trim()) {
      try {
        menuUrl = normalizeMenuUrl(body.menuUrl);
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : "Invalid menu URL" },
          { status: 400 },
        );
      }
    }

    // ---- numeric defaults ----------------------------------------------
    const n = (v: unknown, def: number) =>
      v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0
        ? Number(v).toFixed(2)
        : def.toFixed(2);
    const int = (v: unknown, def: number) =>
      v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 1
        ? String(Math.round(Number(v)))
        : String(def);

    const deliveryFee = n(body.deliveryFee, 0);
    const minOrder = n(body.minOrder, 0);
    const etaMinutes = int(body.etaMinutes, 30);
    const pickupEtaMinutes = int(body.pickupEtaMinutes, 15);
    const tagline = typeof body.tagline === "string" ? body.tagline.trim().slice(0, 200) : "";
    const imageUrl = body.imageUrl.trim();
    const qrImageUrl = typeof body.qrImageUrl === "string" && body.qrImageUrl.trim() ? body.qrImageUrl.trim() : null;
    const taxRate = body.taxRate !== undefined ? n(body.taxRate, 0) : "0";

    const id = await db.transaction(async (tx) => {
      const [restaurant] = await tx
        .insert(restaurants)
        .values({
          name,
          slug,
          marketplaceId: restaurantId(),
          cuisine,
          description,
          address,
          phone,
          openingHours,
          imageUrl,
          priceRange,
          isOpen: true,
          taxRate,
        })
        .returning({ id: restaurants.id });

      await tx.insert(marketplaceProfiles).values({
        restaurantId: restaurant.id,
        isListed: false,
        marketplaceStatus: "pending_review",
        acceptOnlineOrders,
        acceptDelivery,
        acceptPickup,
        menuUrl,
        tagline,
        qrImageUrl,
        deliveryFee,
        minOrder,
        etaMinutes: Number(etaMinutes),
        pickupEtaMinutes: Number(pickupEtaMinutes),
        commissionRate: "12.00",
      });

      // PHASE 33 — every restaurant, including self-enrolled ones, gets a
      // connection record. RestaurantAI is the target provider; the POS is not
      // actually connected yet (status stays disconnected).
      await tx.insert(restaurantIntegrations).values({
        restaurantId: restaurant.id,
        provider: "restaurantai",
        status: "disconnected",
        webhookSecret: webhookSecret(),
      });

      return restaurant.id;
    });

    return Response.json(
      {
        ok: true,
        restaurantId: id,
        slug,
        marketplaceStatus: "pending_review",
        message:
          "Submission received. Your restaurant is pending review and will appear on the marketplace once approved.",
      },
      { status: 201 },
    );
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Failed to create restaurant" }, { status: 500 });
  }
}
