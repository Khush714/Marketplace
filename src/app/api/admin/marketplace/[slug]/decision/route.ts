import { db } from "@/db";
import { restaurants, marketplaceProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/marketplace/:slug/decision
 *
 * Operator approval / rejection of a self-enrolled pending restaurant.
 *   - approve → is_listed=true, marketplace_status='live', listedAt=now
 *               (restaurant becomes visible + orderable on the storefront)
 *   - reject → marketplace_status='draft', is_listed stays false
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const body = await request.json();
    const action = String(body.action ?? "");

    if (action !== "approve" && action !== "reject") {
      return Response.json(
        { error: "action must be 'approve' or 'reject'" },
        { status: 400 },
      );
    }

    const [restaurant] = await db
      .select({ id: restaurants.id })
      .from(restaurants)
      .where(eq(restaurants.slug, slug))
      .limit(1);
    if (!restaurant) {
      return Response.json({ error: "Restaurant not found" }, { status: 404 });
    }

    const [profile] = await db
      .select()
      .from(marketplaceProfiles)
      .where(eq(marketplaceProfiles.restaurantId, restaurant.id))
      .limit(1);
    if (!profile) {
      return Response.json({ error: "Profile not found" }, { status: 404 });
    }

    const patch =
      action === "approve"
        ? {
            isListed: true,
            marketplaceStatus: "live",
            listedAt: new Date(),
            updatedAt: new Date(),
          }
        : {
            isListed: false,
            marketplaceStatus: "draft",
            updatedAt: new Date(),
          };

    const [updated] = await db
      .update(marketplaceProfiles)
      .set(patch)
      .where(eq(marketplaceProfiles.restaurantId, restaurant.id))
      .returning();

    return Response.json({
      ok: true,
      action,
      slug,
      isListed: updated.isListed,
      marketplaceStatus: updated.marketplaceStatus,
    });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Failed to update restaurant decision" }, { status: 500 });
  }
}
