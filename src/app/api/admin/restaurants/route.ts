import { db } from "@/db";
import {
  restaurants,
  marketplaceProfiles,
  restaurantIntegrations,
} from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin-auth";
import { restaurantId } from "@/lib/format";
import { webhookSecret } from "@/lib/integrations";
import { getAllRestaurants } from "@/lib/data";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/restaurants — all restaurants with marketplace + integration
 * status. Used by the admin restaurant management page.
 */
export async function GET() {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await getAllRestaurants();
  return Response.json({ restaurants: rows });
}

/**
 * POST /api/admin/restaurants — create a new restaurant from the admin panel.
 *
 * Creates three records in a single transaction:
 *   1. restaurants (core POS record)
 *   2. restaurant_marketplace_profiles (marketplace satellite, draft)
 *   3. restaurant_integrations (connection record, disconnected)
 */
export async function POST(request: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    // ---- Required-field validation -------------------------------------
    const name =
      typeof body.name === "string" ? body.name.trim().slice(0, 160) : "";
    if (!name) {
      return Response.json(
        { error: "Restaurant name is required" },
        { status: 400 },
      );
    }

    // ---- Slug (auto-generate from name) --------------------------------
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 180);

    if (!slug) {
      return Response.json(
        { error: "Could not generate a valid slug from the restaurant name" },
        { status: 400 },
      );
    }

    // Check slug uniqueness
    const [existing] = await db
      .select({ id: restaurants.id })
      .from(restaurants)
      .where(eq(restaurants.slug, slug))
      .limit(1);
    if (existing) {
      return Response.json(
        { error: "A restaurant with a similar name already exists" },
        { status: 409 },
      );
    }

    // ---- Optional fields ------------------------------------------------
    const address =
      typeof body.address === "string" ? body.address.trim().slice(0, 240) : "";
    const phone =
      typeof body.phone === "string" ? body.phone.trim().slice(0, 40) : "";
    const cuisine =
      typeof body.cuisine === "string" ? body.cuisine.trim().slice(0, 80) : "";
    const openingHours =
      typeof body.openingHours === "string" && body.openingHours.trim()
        ? body.openingHours.trim().slice(0, 4000)
        : "{}";
    const imageUrl =
      typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
    const logoUrl =
      typeof body.logoUrl === "string" ? body.logoUrl.trim() : "";

    // Delivery radius
    const deliveryRadiusKm =
      body.deliveryRadiusKm !== undefined &&
      Number.isFinite(Number(body.deliveryRadiusKm)) &&
      Number(body.deliveryRadiusKm) > 0
        ? Number(body.deliveryRadiusKm).toFixed(2)
        : "8.00";

    // ---- Insert all three records in a transaction ----------------------
    const id = await db.transaction(async (tx) => {
      const [restaurant] = await tx
        .insert(restaurants)
        .values({
          name,
          slug,
          marketplaceId: restaurantId(),
          cuisine: cuisine || "General",
          description: "",
          address,
          phone,
          openingHours,
          imageUrl,
          priceRange: "$$",
          isOpen: true,
          taxRate: "0",
          deliveryRadiusKm,
        })
        .returning({ id: restaurants.id });

      await tx.insert(marketplaceProfiles).values({
        restaurantId: restaurant.id,
        isListed: false,
        marketplaceStatus: "draft",
        acceptOnlineOrders: true,
        acceptDelivery: true,
        acceptPickup: true,
        commissionRate: "12.00",
        logoUrl,
      });

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
        message: "Restaurant created successfully",
      },
      { status: 201 },
    );
  } catch (e) {
    console.error(e);
    return Response.json(
      { error: "Failed to create restaurant" },
      { status: 500 },
    );
  }
}
