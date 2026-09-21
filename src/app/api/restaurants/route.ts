import { NextRequest } from "next/server";
import { browseRestaurants, featuredRestaurants, restaurantsBySlugs } from "@/db/queries";
import type { BrowseFilters } from "@/db/queries";
import { localityByKey } from "@/lib/domain";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const locality = localityByKey(sp.get("loc")).name;

  const slugs = sp.get("slugs");
  if (slugs) {
    const list = slugs.split(",").map((s) => s.trim()).filter(Boolean);
    return Response.json({ restaurants: await restaurantsBySlugs(list) });
  }
  if (sp.get("featured") === "1") {
    return Response.json({ restaurants: await featuredRestaurants(locality) });
  }

  const filters: BrowseFilters = {
    q: sp.get("q") ?? undefined,
    cuisine: sp.get("cuisine") ?? undefined,
    sort: (sp.get("sort") as BrowseFilters["sort"]) ?? undefined,
    offers: sp.get("offers") === "1",
    minRating: sp.get("minRating") === "1",
    veg: sp.get("veg") === "1",
    locality,
  };
  return Response.json({ restaurants: await browseRestaurants(filters) });
}
