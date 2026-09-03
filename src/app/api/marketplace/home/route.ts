import { listPublicRestaurants, listCategories } from "@/lib/marketplace";
import { safeJson, errorJson } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/marketplace/home
 * Single call powering the TABLZ home screen: categories, nearby, popular and
 * top-rated rails. Keeps the consumer app to one round-trip on first paint.
 */
export async function GET() {
  try {
    const [categories, nearby, popular, topRated] = await Promise.all([
      listCategories(),
      listPublicRestaurants({ sort: "nearby", limit: 8 }),
      listPublicRestaurants({ sort: "popular", limit: 8 }),
      listPublicRestaurants({ sort: "rating", limit: 8, minRating: 4 }),
    ]);

    return safeJson({
      categories,
      rails: [
        {
          key: "nearby",
          title: "Nearby restaurants",
          subtitle: "Fastest to reach you",
          items: nearby.items,
        },
        {
          key: "popular",
          title: "Popular restaurants",
          subtitle: "Most ordered and reviewed",
          items: popular.items,
        },
        {
          key: "rating",
          title: "Top rated",
          subtitle: "Rated 4.0 and above",
          items: topRated.items,
        },
      ],
    });
  } catch (e) {
    console.error(e);
    return errorJson("Failed to load home feed", 500);
  }
}
