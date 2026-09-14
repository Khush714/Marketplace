import { db } from "@/db";
import {
  restaurants,
  marketplaceProfiles,
  orders,
  reviews,
  reviewReports,
} from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/** GET /api/admin/overview — operator KPI strip. */
export async function GET() {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const [rest, ord, rev, reports] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)`,
        pending: sql<number>`count(*) filter (where ${marketplaceProfiles.marketplaceStatus} in ('pending_review','draft'))`,
        live: sql<number>`count(*) filter (where ${marketplaceProfiles.marketplaceStatus} = 'live' and ${marketplaceProfiles.isListed})`,
        suspended: sql<number>`count(*) filter (where ${marketplaceProfiles.marketplaceStatus} = 'suspended')`,
      })
      .from(restaurants)
      .innerJoin(
        marketplaceProfiles,
        eq(marketplaceProfiles.restaurantId, restaurants.id),
      ),
    db
      .select({
        live: sql<number>`count(*) filter (where ${orders.status} in ('placed','accepted','preparing','ready','picked_up'))`,
        completed: sql<number>`count(*) filter (where ${orders.status} in ('completed','delivered'))`,
        cancelled: sql<number>`count(*) filter (where ${orders.status} in ('cancelled','rejected'))`,
      })
      .from(orders),
    db
      .select({
        published: sql<number>`count(*) filter (where ${reviews.moderationStatus} = 'published')`,
        pending: sql<number>`count(*) filter (where ${reviews.moderationStatus} = 'pending')`,
      })
      .from(reviews),
    db.select({ n: sql<number>`count(*)` }).from(reviewReports),
  ]);

  return Response.json({
    restaurants: {
      total: Number(rest[0]?.total ?? 0),
      pending: Number(rest[0]?.pending ?? 0),
      live: Number(rest[0]?.live ?? 0),
      suspended: Number(rest[0]?.suspended ?? 0),
    },
    orders: {
      live: Number(ord[0]?.live ?? 0),
      completed: Number(ord[0]?.completed ?? 0),
      cancelled: Number(ord[0]?.cancelled ?? 0),
    },
    reviews: {
      published: Number(rev[0]?.published ?? 0),
      pending: Number(rev[0]?.pending ?? 0),
      reports: Number(reports[0]?.n ?? 0),
    },
  });
}
