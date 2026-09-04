import { db } from "@/db";
import { reviewReports, reviews, restaurants } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/** GET /api/admin/reviews/reports — reported reviews for the operator. */
export async function GET() {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await db
    .select({
      id: reviewReports.id,
      reason: reviewReports.reason,
      note: reviewReports.note,
      createdAt: reviewReports.createdAt,
      reviewId: reviews.id,
      author: reviews.customerName,
      rating: reviews.rating,
      comment: reviews.comment,
      moderationStatus: reviews.moderationStatus,
      restaurantName: restaurants.name,
      restaurantSlug: restaurants.slug,
    })
    .from(reviewReports)
    .innerJoin(reviews, eq(reviews.id, reviewReports.reviewId))
    .innerJoin(restaurants, eq(restaurants.id, reviews.restaurantId))
    .orderBy(desc(reviewReports.createdAt))
    .limit(100);

  return Response.json({
    reports: rows.map((r) => ({
      id: r.id,
      reason: r.reason,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
      review: {
        id: r.reviewId,
        author: r.author,
        rating: r.rating,
        comment: r.comment,
        moderationStatus: r.moderationStatus,
        restaurant: { name: r.restaurantName, slug: r.restaurantSlug },
      },
    })),
  });
}
