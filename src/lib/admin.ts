import { db } from "@/db";
import { orders, reviews } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * PHASE 16 — marketplace stats for the restaurant admin (one dashboard, no
 * second app). The rating uses the same weighted/published formula the
 * consumer sees, so the owner and customers agree about the storefront.
 */
const weightedRatingExpr = sql<number>`coalesce(
  sum(${reviews.rating} * case when ${reviews.isVerified} then 1.0 else 0.5 end) filter (where ${reviews.moderationStatus} = 'published')
  / nullif(sum(case when ${reviews.isVerified} then 1.0 else 0.5 end) filter (where ${reviews.moderationStatus} = 'published'), 0),
  0)`;

export async function marketplaceStats(restaurantId: number) {
  const [orderStats, reviewStats] = await Promise.all([
    db
      .select({
        orderCount: sql<number>`count(*)`,
        revenue: sql<string>`coalesce(sum(${orders.total}) filter (where ${orders.status} <> 'cancelled'), 0)`,
        liveOrders: sql<number>`count(*) filter (where ${orders.status} in ('placed','accepted','preparing','ready'))`,
      })
      .from(orders)
      .where(eq(orders.restaurantId, restaurantId)),
    db
      .select({
        rating: weightedRatingExpr,
        reviewCount: sql<number>`count(${reviews.id}) filter (where ${reviews.moderationStatus} = 'published')`,
      })
      .from(reviews)
      .where(eq(reviews.restaurantId, restaurantId)),
  ]);

  return {
    orderCount: Number(orderStats[0]?.orderCount ?? 0),
    revenue: Number(orderStats[0]?.revenue ?? 0),
    liveOrders: Number(orderStats[0]?.liveOrders ?? 0),
    rating: Math.round(Number(reviewStats[0]?.rating ?? 0) * 10) / 10,
    reviewCount: Number(reviewStats[0]?.reviewCount ?? 0),
  };
}
