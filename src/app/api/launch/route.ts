import { db } from "@/db";
import {
  restaurants,
  marketplaceProfiles,
  customers,
  reviews,
} from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Launch readiness — discovery-first.
 *   🚀 MARKETPLACE = restaurants listed, menu URLs wired, reviews flowing.
 */
export async function GET() {
  const [rs, cs, rv] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)`,
        live: sql<number>`count(*) filter (where ${marketplaceProfiles.isListed} and ${marketplaceProfiles.marketplaceStatus} = 'live')`,
        withMenuUrl: sql<number>`count(*) filter (where ${marketplaceProfiles.menuUrl} <> '')`,
      })
      .from(restaurants)
      .innerJoin(
        marketplaceProfiles,
        eq(marketplaceProfiles.restaurantId, restaurants.id),
      ),
    db.select({ n: sql<number>`count(*)` }).from(customers),
    db
      .select({
        published: sql<number>`count(*) filter (where ${reviews.moderationStatus} = 'published')`,
      })
      .from(reviews),
  ]);

  const total = Number(rs[0]?.total ?? 0);
  const live = Number(rs[0]?.live ?? 0);
  const wired = Number(rs[0]?.withMenuUrl ?? 0);
  const cust = Number(cs[0]?.n ?? 0);
  const revs = Number(rv[0]?.published ?? 0);

  const gates = [
    { name: "10 restaurants onboarded", met: total >= 10, value: total },
    { name: "All restaurants live", met: live === total && total > 0, value: live },
    {
      name: "Every live restaurant has a menu URL",
      met: wired === live && live > 0,
      value: `${wired}/${live}`,
    },
    { name: "100 customers", met: cust >= 100, value: cust },
    { name: "Reviews flowing", met: revs >= 1, value: revs },
  ];
  const ok = gates.every((g) => g.met);

  return Response.json(
    {
      ok,
      summary: ok ? "🚀 ready to launch" : "pre-launch — gates still pending",
      gates,
      metrics: {
        restaurants: total,
        live,
        menuUrlsWired: wired,
        customers: cust,
        publishedReviews: revs,
      },
    },
    { status: ok ? 200 : 503 },
  );
}
