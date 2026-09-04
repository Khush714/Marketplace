import { db } from "@/db";
import { reviews, restaurants } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { num } from "@/lib/format";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/** GET /api/admin/reviews — full moderation queue with restaurant info. */
export async function GET() {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await db
    .select({
      id: reviews.id,
      restaurantId: reviews.restaurantId,
      restaurantName: restaurants.name,
      restaurantSlug: restaurants.slug,
      customerName: reviews.customerName,
      rating: reviews.rating,
      comment: reviews.comment,
      isVerified: reviews.isVerified,
      moderationStatus: reviews.moderationStatus,
      response: reviews.response,
      createdAt: reviews.createdAt,
      orderId: reviews.orderId,
    })
    .from(reviews)
    .innerJoin(restaurants, eq(restaurants.id, reviews.restaurantId))
    .orderBy(desc(reviews.createdAt))
    .limit(200);

  return Response.json({
    reviews: rows.map((r) => ({
      id: r.id,
      restaurant: { id: r.restaurantId, name: r.restaurantName, slug: r.restaurantSlug },
      author: r.customerName,
      rating: r.rating,
      comment: r.comment,
      verified: r.isVerified,
      moderationStatus: r.moderationStatus,
      response: r.response,
      hasOrder: r.orderId !== null,
      createdAt: r.createdAt.toISOString(),
    })),
    stats: {
      total: rows.length,
      published: rows.filter((r) => r.moderationStatus === "published").length,
      pending: rows.filter((r) => r.moderationStatus === "pending").length,
      hidden: rows.filter((r) => r.moderationStatus === "hidden").length,
    },
  });
}
