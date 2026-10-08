import { NextRequest } from "next/server";
import { browseRestaurants, featuredRestaurants, restaurantsBySlugs } from "@/db/queries";
import type { BrowseFilters } from "@/db/queries";
import { localityByKey } from "@/lib/domain";
import { clampSearchQuery, clampSlugList } from "@/lib/abuse-core";
import { guardRead } from "@/lib/abuse";

export const revalidate = 60;

const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=600" };

/**
 * Public listing data: browse, featured, and bulk-by-slug.
 *
 * Read-only and unauthenticated by design, but unbounded it becomes a catalogue
 * export — a scraper can walk every slug in sorted order and never hit a route
 * that looks like abuse. So the per-client budget is generous (this is refetched
 * on every filter change) and the *request* is bounded instead: the slug list is
 * capped, because that array is spliced straight into an `inArray(...)` and one
  request carrying thousands of values is the cheaper way to scrape.
 */
export async function GET(req: NextRequest) {
  const throttled = guardRead(req, "restaurants");
  if (throttled) return throttled;

  const sp = req.nextUrl.searchParams;
  const locality = localityByKey(sp.get("loc")).name;

  const slugs = sp.get("slugs");
  if (slugs) {
    return Response.json(
      { restaurants: await restaurantsBySlugs(clampSlugList(slugs)) },
      { headers: CACHE_HEADERS },
    );
  }
  if (sp.get("featured") === "1") {
    return Response.json(
      { restaurants: await featuredRestaurants(locality) },
      { headers: CACHE_HEADERS },
    );
  }

  const filters: BrowseFilters = {
    q: clampSearchQuery(sp.get("q")),
    cuisine: sp.get("cuisine") ?? undefined,
    sort: (sp.get("sort") as BrowseFilters["sort"]) ?? undefined,
    offers: sp.get("offers") === "1",
    minRating: sp.get("minRating") === "1",
    veg: sp.get("veg") === "1",
    locality,
  };
  return Response.json(
    { restaurants: await browseRestaurants(filters) },
    { headers: CACHE_HEADERS },
  );
}
