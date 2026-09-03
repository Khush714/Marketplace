import { listPublicRestaurants, type SortKey } from "@/lib/marketplace";
import { safeJson, errorJson, parsePagination } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/marketplace/restaurants
 * ?search=&cuisine=&priceRange=&featured=&open=&limit=&offset=
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const { limit, offset } = parsePagination(new URL(request.url));
    const result = await listPublicRestaurants({
      search: searchParams.get("search") ?? undefined,
      cuisine: searchParams.get("cuisine") ?? undefined,
      priceRange: searchParams.get("priceRange") ?? undefined,
      sort: (searchParams.get("sort") as SortKey | null) ?? undefined,
      minRating: Number(searchParams.get("minRating")) || undefined,
      featuredOnly: searchParams.get("featured") === "true",
      openOnly: searchParams.get("open") === "true",
      pickup: searchParams.get("pickup") === "true",
      delivery: searchParams.get("delivery") === "true",
      vegetarian: searchParams.get("vegetarian") === "true",
      lat: Number(searchParams.get("lat")) || undefined,
      lng: Number(searchParams.get("lng")) || undefined,
      limit,
      offset,
    });
    return safeJson({
      items: result.items,
      total: result.total,
      limit,
      offset,
    });
  } catch (e) {
    console.error(e);
    if (e instanceof Error && e.message.includes("Customer-unsafe")) {
      return errorJson(e.message, 500);
    }
    return errorJson("Failed to load restaurants", 500);
  }
}
